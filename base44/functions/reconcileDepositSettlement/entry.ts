import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { buildCheckLookupPath, seamlessRequest, SEAMLESS_PROVIDER_KEY } from '../../shared/seamlessAch.ts';
import { claimWebhookEvent, finishWebhookEvent } from '../../shared/seamlessAtomicStore.ts';
import { depositProviderReference, flagDepositReview } from '../../shared/depositReconciliation.ts';
import { isFeeDeposit, verifyProviderDeposit, settlementMatches, returnFeeAmounts, moneyCents } from '../../shared/depositReconciliationPure.js';
import { postSeamlessSettlement } from '../../shared/seamlessLedgerTransitions.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';

const clean = value => String(value || '').trim();
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, '0')).join('');
}
async function resolveFinding(base44, tx, kind, adminId, evidenceId) {
  const key = 'deposit-' + kind + '-reconciliation:' + tx.id;
  const findings = await base44.asServiceRole.entities.OperationsFinding.filter({ finding_key: key }, '-created_date', 20);
  for (const finding of findings) {
    if (['resolved', 'dismissed'].includes(finding.status)) continue;
    await base44.asServiceRole.entities.OperationsFinding.update(finding.id, {
      status: 'resolved', resolution: 'Administrator verified Seamless evidence ' + evidenceId,
      resolved_by_admin_id: adminId, resolved_at: new Date().toISOString(),
    });
  }
}
Deno.serve(async req => {
  let lock = null;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const input = await req.json();
    if (input.action === 'list') {
      const skip = Number(input.skip || 0);
      if (!Number.isInteger(skip) || skip < 0 || skip > 100000) return Response.json({ error: 'invalid_page' }, { status: 400 });
      const rows = await base44.asServiceRole.entities.WalletTransaction.filter(
        { type: 'deposit', deposit_pricing_version: { $exists: true } }, '-created_date', 101, skip);
      const page = rows.slice(0, 100).filter(isFeeDeposit);
      const refs = page.length ? await base44.asServiceRole.entities.IntegrationReference.filter({
        provider_key: SEAMLESS_PROVIDER_KEY, wallet_transaction_id: { $in: page.map(tx => tx.id) },
      }, '-effective_at', 500) : [];
      return Response.json({ hasMore: rows.length > 100, transactions: page.map(tx => ({
        provider_reference_id: refs.find(ref => ref.wallet_transaction_id === tx.id && ref.external_reference_id && !ref.external_reference_id.startsWith('chessbet-'))?.external_reference_id || '',
        id: tx.id, amount: tx.amount, bank_debit: tx.deposit_bank_debit,
        processing_fee: tx.deposit_processing_fee, status: tx.status,
        hold_status: tx.deposit_hold_status, created_date: tx.created_date,
        reconciliation_status: tx.deposit_reconciliation_status || 'awaiting_evidence',
        reconciliation_reason: tx.deposit_reconciliation_reason || '',
        return_reconciliation_status: tx.deposit_return_reconciliation_status || '',
      })) });
    }
    const kind = input.action === 'recordSettlement' ? 'settlement' : input.action === 'recordReturn' ? 'return' : '';
    if (!kind || !clean(input.transactionId)) return Response.json({ error: 'invalid_request' }, { status: 400 });
    if (input.confirmedAgainstSeamless !== true ||
        !['seamless_statement', 'seamless_support'].includes(input.source) ||
        clean(input.evidenceReference).length < 8 || clean(input.evidenceReference).length > 1000) {
      return Response.json({ error: 'A Seamless statement or support reference and confirmation of the actual amounts are required.' }, { status: 400 });
    }
    let tx = await base44.asServiceRole.entities.WalletTransaction.get(input.transactionId);
    if (!isFeeDeposit(tx)) return Response.json({ error: 'This review applies only to deposits created with the fee feature.' }, { status: 409 });
    const providerRef = await depositProviderReference(base44, tx);
    const values = kind === 'settlement' ? {
      bank_debit: moneyCents(input.bankDebit) / 100,
      processing_fee: moneyCents(input.processingFee) / 100,
      net_received: moneyCents(input.netReceived) / 100,
    } : {
      processing_fee_retained: moneyCents(input.processingFeeRetained) / 100,
      return_fee: moneyCents(input.returnFee) / 100,
      additional_cash_debit: moneyCents(input.additionalCashDebit) / 100,
    };
    const key = 'deposit-evidence:' + tx.id + ':' + kind + ':' + await digest({
      ...values, source: input.source, reference: clean(input.evidenceReference),
    });
    const owner = crypto.randomUUID();
    const claim = await claimWebhookEvent(key, providerRef, owner);
    if (claim?.claim === 'completed') return Response.json({ matched: true, deduplicated: true });
    if (claim?.claim !== 'owned') return Response.json({ error: 'Deposit is being updated. Please retry shortly.' }, { status: 409 });
    lock = { key, providerRef, owner };
    tx = await base44.asServiceRole.entities.WalletTransaction.get(tx.id);
    const providerData = await seamlessRequest('GET', buildCheckLookupPath(providerRef));
    const observation = verifyProviderDeposit(tx, providerRef, providerData, kind === 'settlement');
    if (kind === 'settlement' && ['failed', 'reversed'].includes(tx.status)) throw new Error('deposit_already_returned');
    if (kind === 'return' && (
      !['failed', 'reversed'].includes(tx.status) ||
      !['failed', 'refunded', 'voided', 'declined', 'expired'].includes(observation.status)
    )) throw new Error('deposit_return_not_confirmed');

    const matched = kind === 'settlement' ? settlementMatches(tx, values) : Boolean(returnFeeAmounts(tx, values));
    const prior = (await base44.asServiceRole.entities.DepositSettlementEvidence.filter({
      wallet_transaction_id: tx.id, kind, result: 'matched',
    }, '-recorded_at', 2));
    if (prior.length > 1) throw new Error('duplicate_deposit_evidence');
    if (prior[0] && Object.keys(values).some(field => moneyCents(prior[0][field]) !== moneyCents(values[field]))) {
      throw new Error('verified_evidence_cannot_be_overwritten');
    }
    let evidence = prior[0] || (await base44.asServiceRole.entities.DepositSettlementEvidence.filter({
      evidence_key: key,
    }, '-recorded_at', 1))[0];
    if (!evidence) {
      const now = new Date();
      const retention = new Date(now); retention.setUTCFullYear(retention.getUTCFullYear() + 2);
      evidence = await base44.asServiceRole.entities.DepositSettlementEvidence.create({
        wallet_transaction_id: tx.id, provider_reference_id: providerRef, kind,
        result: matched ? 'matched' : 'mismatch', pricing_version: tx.deposit_pricing_version,
        ...values, source: input.source, evidence_reference: clean(input.evidenceReference),
        recorded_by: user.id, recorded_at: now.toISOString(), evidence_key: key,
        retention_until: retention.toISOString(),
      });
    }
    if (!matched) {
      await flagDepositReview(base44, tx, 'statement_amount_mismatch');
      await finishWebhookEvent(key, providerRef, owner, 'retryable', 'statement_amount_mismatch');
      lock = null;
      return Response.json({ matched: false, error: 'The actual amounts do not match the authorized deposit. Funds remain unavailable.', evidenceId: evidence.id }, { status: 409 });
    }
    if (kind === 'settlement') {
      if (tx.status !== 'completed') {
        await postSeamlessSettlement(base44, tx, Number(tx.amount), providerRef, 'admin_verified_deposit_settlement');
      }
    } else {
      const fees = returnFeeAmounts(tx, values);
      if (fees.cash > 0) {
        const legs = [
          ...(fees.retained ? [{ ledgerAccount: 'processor_fee_expense', debit: fees.retained / 100, credit: 0 }] : []),
          ...(fees.returnFee ? [{ ledgerAccount: 'ach_return_fee_expense', debit: fees.returnFee / 100, credit: 0 }] : []),
          { ledgerAccount: 'settlement', debit: 0, credit: fees.cash / 100 },
        ].map(leg => ({ ...leg, transactionType: 'reversal', walletTransactionId: tx.id }));
        await postLedgerLegs(base44, {
          groupId: 'seamless:deposit:return-fees:' + tx.id,
          updateTransactions: false,
          actor: 'system', triggerEvent: 'deposit_return_processor_fees',
          externalRefType: 'provider_reversal', externalRefId: providerRef, legs,
        });
      }
      await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
        deposit_return_reconciliation_status: 'matched', deposit_return_evidence_id: evidence.id,
      });
    }
    await resolveFinding(base44, tx, kind, user.id, evidence.id);
    await finishWebhookEvent(key, providerRef, owner, 'completed');
    lock = null;
    return Response.json({ matched: true, evidenceId: evidence.id,
      message: kind === 'settlement' ? 'Settlement verified. The deposit remains subject to its clearing hold and a fresh Seamless status check.' : 'Actual processor and return charges reconciled.' });
  } catch (error) {
    if (lock) {
      try { await finishWebhookEvent(lock.key, lock.providerRef, lock.owner, 'retryable', 'deposit_review_failed'); } catch { /* lease expires */ }
    }
    const safe = ['invalid_money', 'return_fee_amount_mismatch', 'provider_bank_debit_mismatch',
      'provider_reference_mismatch', 'provider_label_mismatch', 'provider_currency_mismatch',
      'provider_not_processed', 'deposit_already_returned', 'deposit_return_not_confirmed',
      'verified_evidence_cannot_be_overwritten', 'duplicate_deposit_evidence',
      'invalid_saved_deposit_quote', 'deposit_reconciliation_required'];
    return Response.json({ error: safe.includes(error?.message) ? error.message : 'Deposit verification could not complete. Funds have not been released.' }, { status: 409 });
  }
});
