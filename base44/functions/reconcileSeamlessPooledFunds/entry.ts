import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import {
  buildMerchantBalanceLookupPath,
  PATH_ACCOUNT,
  seamlessConfig,
  seamlessRequest,
  SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { reconcileSeamlessMerchantBalance } from '../../shared/seamlessMerchantBalancePure.js';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

const PAGE_SIZE = 5000;
const MAX_ROWS = 100000;

async function allRows(entity) {
  const rows = [];
  for (let skip = 0; skip < MAX_ROWS; skip += PAGE_SIZE) {
    const page = await entity.list('created_date', PAGE_SIZE, skip);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw new Error('reconciliation_row_limit_exceeded');
}

function clean(value, max = 255) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function merchantUserId(data) {
  return clean(
    data?.user_id || data?.account?.user_id || data?.data?.user_id ||
    data?.data?.account?.user_id || data?.user?.user_id || data?.id
  );
}

function finiteMoney(candidates, field, fallback = null) {
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const parsed = Number(String(value).replace(/[$,]/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000_000) {
      return Math.round(parsed * 100) / 100;
    }
  }
  if (fallback != null) return fallback;
  throw new Error(`missing_or_invalid_${field}`);
}

function balanceValues(data) {
  const root = data?.data || data || {};
  const balance = root?.balance && typeof root.balance === 'object' ? root.balance : {};
  const available = finiteMoney([
    root.available_balance, root.available, balance.available_balance,
    balance.available, root.balance_amount,
    typeof root.balance === 'number' || typeof root.balance === 'string' ? root.balance : null,
  ], 'available_balance');
  const pending = finiteMoney([
    root.pending_balance, root.pending, balance.pending_balance, balance.pending,
  ], 'pending_balance', 0);
  return { available, pending };
}

async function upsertFinding(base44, result, reconciliationId, checkedAt) {
  if (result.status !== 'shortfall') return;
  const key = 'seamless-pooled-funds-shortfall';
  const fields = {
    finding_key: key,
    category: 'settlement_ledger',
    priority: 'critical',
    status: 'human_approval_required',
    authority_level: 'human_approval_required',
    title: 'Seamless pooled funds do not cover player wallet liabilities',
    summary: `The hourly provider balance check found a $${Math.abs(result.settled_coverage_variance).toFixed(2)} shortfall.`,
    evidence: `Reconciliation ${reconciliationId}; checked ${checkedAt}; provider available $${result.provider_available_balance.toFixed(2)}; player liability $${result.player_ledger_liability.toFixed(2)}.`,
    recommended_next_step: 'Pause discretionary payouts and have an administrator compare the Seamless merchant ledger, bank settlement activity, and ChessBet journal before moving funds.',
    is_approval_required: true,
    related_entity_type: 'settlement_reconciliation',
    related_entity_id: reconciliationId,
  };
  const existing = (await base44.asServiceRole.entities.OperationsFinding.filter(
    { finding_key: key },
    '-created_date',
    1
  ))[0];
  if (existing && !['resolved', 'dismissed'].includes(existing.status)) {
    await base44.asServiceRole.entities.OperationsFinding.update(existing.id, fields);
  } else {
    await base44.asServiceRole.entities.OperationsFinding.create(fields);
  }
}

// Hourly, read-only provider cash observation plus internal liability comparison.
// This verifies numerical coverage; it does not make a legal custody or
// segregation determination.
Deno.serve(async (req) => {
  const checkedAt = new Date().toISOString();
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    seamlessConfig();

    const bucket = checkedAt.slice(0, 13);
    const idempotencyKey = `seamless-api-hourly-${bucket}`;
    const existing = (await base44.asServiceRole.entities['seamless-merchant-balance-snapshot'].filter(
      { idempotency_key: idempotencyKey },
      '-created_at',
      1
    ))[0];
    if (existing) {
      const reconciliation = (await base44.asServiceRole.entities['seamless-pooled-funds-reconciliation'].filter(
        { snapshot_id: existing.id },
        '-created_at',
        1
      ))[0] || null;
      return Response.json({ snapshot: existing, reconciliation, deduplicated: true });
    }

    const accountData = await seamlessRequest('GET', PATH_ACCOUNT);
    const providerUserId = merchantUserId(accountData);
    if (!providerUserId) throw new Error('missing_merchant_user_id');
    const balanceData = await seamlessRequest('GET', buildMerchantBalanceLookupPath(providerUserId));
    const provider = balanceValues(balanceData);

    const [wallets, transactions] = await Promise.all([
      allRows(base44.asServiceRole.entities.Wallet),
      allRows(base44.asServiceRole.entities.WalletTransaction),
    ]);

    let playerAvailableLiability = 0;
    let playerHeldLiability = 0;
    for (const wallet of wallets) {
      playerAvailableLiability += Number(wallet.available_balance || 0);
      playerHeldLiability += Number(wallet.held_balance || 0);
    }

    let pendingDepositAmount = 0;
    let reservedWithdrawalAmount = 0;
    let uncertainWithdrawalAmount = 0;
    for (const tx of transactions) {
      const value = Number(tx.amount || 0);
      if (!Number.isFinite(value) || value < 0) continue;
      if (tx.type === 'deposit' && ['pending', 'submitting', 'submitted', 'uncertain'].includes(tx.integration_status)) {
        pendingDepositAmount += value;
      }
      if (tx.type === 'withdrawal' && ['reserved', 'submitting', 'submitted', 'uncertain'].includes(tx.integration_status)) {
        reservedWithdrawalAmount += value;
        if (tx.integration_status === 'uncertain') uncertainWithdrawalAmount += value;
      }
    }

    const result = reconcileSeamlessMerchantBalance({
      providerAvailableBalance: provider.available,
      providerPendingBalance: provider.pending,
      playerAvailableLiability,
      playerHeldLiability,
      pendingDepositAmount,
      reservedWithdrawalAmount,
      uncertainWithdrawalAmount,
      snapshotAsOf: checkedAt,
      calculatedAt: checkedAt,
      staleAfterHours: 2,
    });

    const snapshot = await base44.asServiceRole.entities['seamless-merchant-balance-snapshot'].create({
      provider_key: SEAMLESS_PROVIDER_KEY,
      available_balance: result.provider_available_balance,
      pending_balance: result.provider_pending_balance,
      currency: 'USD',
      as_of: checkedAt,
      source: 'seamless_api',
      provider_reference_id: providerUserId,
      idempotency_key: idempotencyKey,
      captured_by: caller.id,
      notes: 'Automated hourly API snapshot. Numerical coverage only; not a legal custody certification.',
      created_at: checkedAt,
    });
    const fields = {
      snapshot_id: snapshot.id,
      ...result,
      calculation_json: JSON.stringify({
        method: 'merchant_settled_balance_minus_internal_player_liability',
        provider_balance_scope: 'merchant_pool',
        player_balance_scope: 'internal_ledger',
        custody_certification: false,
        pending_deposits_informational_only: true,
      }),
      created_by: caller.id,
      created_at: checkedAt,
    };
    if (fields.coverage_ratio == null) delete fields.coverage_ratio;
    const reconciliation = await base44.asServiceRole.entities['seamless-pooled-funds-reconciliation'].create(fields);

    await upsertFinding(base44, result, reconciliation.id, checkedAt);
    await recordIntegrationEvent(base44, {
      eventType: 'financial.seamless_merchant_balance_reconciled',
      aggregateType: 'ledger_group',
      aggregateId: reconciliation.id,
      correlationId: snapshot.id,
      idempotencyKey: `seamless:merchant-balance:${idempotencyKey}`,
      actorType: 'system',
      actorId: caller.id,
      status: result.status,
      amount: result.settled_coverage_variance,
      result: result.status,
      eventData: {
        snapshot_id: snapshot.id,
        provider_balance_scope: 'merchant_pool',
        player_balance_scope: 'internal_ledger',
        custody_certification: false,
      },
    });

    return Response.json({ snapshot, reconciliation, deduplicated: false });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'seamless_pooled_funds_reconciliation_failed',
      error: clean(error?.message || 'unknown_error', 128),
    }));
    return Response.json({ error: 'seamless_pooled_funds_reconciliation_failed' }, { status: 500 });
  }
});
