import { buildCheckLookupPath, seamlessRequest, SEAMLESS_PROVIDER_KEY } from './seamlessAch.ts';
import { postLedgerLegs } from './ledger.ts';
import { contractSettlementAmounts, isFeeDeposit, verifyProviderDeposit, verifySettlementEvidence } from './depositReconciliationPure.js';

export async function depositProviderReference(base44, tx) {
  const refs = await base44.asServiceRole.entities.IntegrationReference.filter({
    provider_key: SEAMLESS_PROVIDER_KEY, wallet_transaction_id: tx.id,
  }, '-effective_at', 20);
  const ids = [...new Set(refs.map(ref => String(ref.external_reference_id || ''))
    .filter(id => id && !id.startsWith('chessbet-')))];
  if (ids.length !== 1) throw new Error('deposit_provider_reference_ambiguous');
  return ids[0];
}

export async function flagDepositReview(base44, tx, reason, kind = 'settlement') {
  if (!isFeeDeposit(tx)) return;
  const isReturn = kind === 'return';
  const status = reason === 'settlement_evidence_required' ? 'awaiting_evidence' : 'mismatch';
  await base44.asServiceRole.entities.WalletTransaction.update(tx.id, isReturn ? {
    deposit_return_reconciliation_status: 'awaiting_evidence',
  } : {
    deposit_reconciliation_status: status,
    deposit_reconciliation_reason: reason,
  });
  const key = 'deposit-' + kind + '-reconciliation:' + tx.id;
  const existing = (await base44.asServiceRole.entities.OperationsFinding.filter({ finding_key: key }, '-created_date', 1))[0];
  const fields = {
    finding_key: key, category: 'settlement_ledger', priority: isReturn ? 'high' : 'critical',
    status: 'human_approval_required', authority_level: 'human_approval_required',
    title: isReturn ? 'Returned deposit requires processor fee reconciliation' : 'Deposit awaits verified Seamless settlement amounts',
    summary: isReturn
      ? 'Wallet principal follows the bank return. Retained processing fees and return charges require separate evidence and accounting.'
      : 'The saved bank charge, processor deduction, and net proceeds must agree before this deposit can be credited or released.',
    evidence: JSON.stringify({ wallet_transaction_id: tx.id, reason }),
    recommended_next_step: 'Open Player & Financial Review > Deposit reconciliation and record the actual Seamless statement amounts and statement or support reference.',
    is_approval_required: true, related_entity_type: 'wallet_transaction', related_entity_id: tx.id,
  };
  if (existing && !['resolved', 'dismissed'].includes(existing.status)) {
    await base44.asServiceRole.entities.OperationsFinding.update(existing.id, fields);
  } else {
    await base44.asServiceRole.entities.OperationsFinding.create(fields);
  }
}

async function automaticSettlementEvidence(base44, tx, providerRef) {
  const evidenceKey = `deposit-settlement:auto-contract:${tx.id}:${providerRef}:${tx.deposit_pricing_version}`;
  const existing = await base44.asServiceRole.entities.DepositSettlementEvidence.filter({ evidence_key: evidenceKey }, '-recorded_at', 2);
  if (existing.length) return existing[0];
  const values = contractSettlementAmounts(tx);
  const now = new Date();
  const retention = new Date(now); retention.setUTCFullYear(retention.getUTCFullYear() + 2);
  return base44.asServiceRole.entities.DepositSettlementEvidence.create({
    wallet_transaction_id: tx.id, provider_reference_id: providerRef,
    kind: 'settlement', result: 'matched', pricing_version: tx.deposit_pricing_version,
    ...values, source: 'seamless_api_contract',
    evidence_reference: `Seamless single-payment API Processed; contracted ACH deduction; ${providerRef}; ${now.toISOString()}`,
    recorded_by: 'system:seamless-reconciliation', recorded_at: now.toISOString(),
    evidence_key: evidenceKey, retention_until: retention.toISOString(),
  });
}

async function resolveAutomaticSettlementFinding(base44, tx, evidenceId) {
  const findings = await base44.asServiceRole.entities.OperationsFinding.filter({
    finding_key: 'deposit-settlement-reconciliation:' + tx.id,
  }, '-created_date', 20);
  for (const finding of findings) {
    if (['resolved', 'dismissed'].includes(finding.status)) continue;
    await base44.asServiceRole.entities.OperationsFinding.update(finding.id, {
      status: 'resolved',
      resolution: 'Automatically matched fresh Seamless Processed status to the accepted v2/v3 ACH pricing contract and evidence ' + evidenceId,
      resolved_at: new Date().toISOString(),
    });
  }
}

// Re-read the exact payment. For v2/v3 deposits, a fresh Processed response
// plus the immutable payment ID, gross amount, currency and ChessBet label can
// create a contract-derived evidence record under the provider lock. Manual
// statement/support evidence remains the fallback for legacy pricing, returns,
// and every mismatch.
export async function requireVerifiedDeposit(base44, tx, suppliedRef) {
  if (!isFeeDeposit(tx)) return null; // Historical transfers retain their existing behavior.
  try {
    const ref = await depositProviderReference(base44, tx);
    if (suppliedRef && suppliedRef !== ref) throw new Error('provider_reference_mismatch');
    const data = await seamlessRequest('GET', buildCheckLookupPath(ref));
    verifyProviderDeposit(tx, ref, data);
    let evidence = await base44.asServiceRole.entities.DepositSettlementEvidence.filter({
      wallet_transaction_id: tx.id, kind: 'settlement', result: 'matched',
    }, '-recorded_at', 2);
    if (!evidence.length) evidence = [await automaticSettlementEvidence(base44, tx, ref)];
    if (evidence.length > 1 && !evidence.every(item =>
      item.source === 'seamless_api_contract' && item.evidence_key === evidence[0].evidence_key
    )) throw new Error('settlement_evidence_ambiguous');
    const amounts = verifySettlementEvidence(tx, evidence[0], ref);
    await base44.asServiceRole.entities.WalletTransaction.update(tx.id, {
      deposit_reconciliation_status: 'matched', deposit_reconciliation_reason: '',
      deposit_settlement_evidence_id: evidence[0].id,
    });
    if (evidence[0].source === 'seamless_api_contract') {
      await resolveAutomaticSettlementFinding(base44, tx, evidence[0].id);
    }
    return { ...amounts, providerRef: ref, evidenceId: evidence[0].id };
  } catch (error) {
    const known = [
      'invalid_money', 'invalid_saved_deposit_quote', 'deposit_provider_reference_ambiguous',
      'provider_reference_mismatch', 'provider_bank_debit_mismatch', 'provider_currency_mismatch',
      'provider_label_mismatch', 'provider_not_processed', 'settlement_evidence_required',
      'settlement_evidence_ambiguous', 'automatic_settlement_evidence_unsupported',
      'automatic_settlement_evidence_mismatch',
    ];
    const reason = known.includes(error?.message) ? error.message : 'provider_verification_unavailable';
    await flagDepositReview(base44, tx, reason);
    throw new Error('deposit_reconciliation_required');
  }
}

// Together with the principal settlement group, incoming settlement debits
// total the gross bank charge. Actual provider deductions clear to zero.
// For v3, $0.50 of evidenced retained proceeds stays in processor_fee_clearing
// to fund the future standard same-day ACH payout. Only any remainder is
// deposit-fee revenue; the payout reserve is never player money or revenue.
export async function postDepositFeePassThrough(base44, tx, verified) {
  if (!verified) return;
  const fee = verified.fee / 100;
  const reserveCents = Math.min(Number(verified.payoutReserve || 0), Number(verified.retained || 0));
  const revenueCents = Math.max(0, Number(verified.retained || 0) - reserveCents);
  const leg = (ledgerAccount, debit, credit) => ({
    ledgerAccount, debit, credit, transactionType: 'deposit', walletTransactionId: tx.id,
  });
  await postLedgerLegs(base44, {
    groupId: 'seamless:deposit:processor-fee:' + tx.id,
    updateTransactions: false,
    actor: 'system', triggerEvent: 'deposit_processor_fee_pass_through',
    externalRefType: 'provider_payment', externalRefId: verified.providerRef,
    legs: [
      leg('settlement', fee, 0), leg('processor_fee_clearing', 0, fee),
      leg('processor_fee_clearing', fee, 0), leg('settlement', 0, fee),
      ...(reserveCents > 0 ? [
        leg('settlement', reserveCents / 100, 0),
        leg('processor_fee_clearing', 0, reserveCents / 100),
      ] : []),
      ...(revenueCents > 0 ? [
        leg('settlement', revenueCents / 100, 0),
        leg('deposit_fee_revenue', 0, revenueCents / 100),
      ] : []),
    ],
  });
}
