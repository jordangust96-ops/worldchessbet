import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { requireAdminMfa } from '../../shared/mfa.ts';
import { reconcileSeamlessMerchantBalance } from '../../shared/seamlessMerchantBalancePure.js';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const SOURCES = new Set(['seamless_dashboard', 'seamless_api', 'seamless_support', 'manual_admin']);
const PAGE_SIZE = 5000;
const MAX_ROWS = 100000;

async function allRows(entity, sort = 'created_date') {
  const rows = [];
  for (let skip = 0; skip < MAX_ROWS; skip += PAGE_SIZE) {
    const page = await entity.list(sort, PAGE_SIZE, skip);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw new Error('reconciliation_row_limit_exceeded');
}

function amount(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new Error(`invalid_${field}`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    const body = await req.json();
    const mfaError = await requireAdminMfa(base44, admin, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;

    const idempotencyKey = String(body?.idempotencyKey || '');
    const source = String(body?.source || '');
    const asOf = new Date(String(body?.asOf || ''));
    if (!IDEMPOTENCY_KEY.test(idempotencyKey) || !SOURCES.has(source) || !Number.isFinite(asOf.getTime())) {
      return Response.json({ error: 'invalid_snapshot_request' }, { status: 400 });
    }

    const existing = (await base44.asServiceRole.entities.SeamlessMerchantBalanceSnapshot.filter(
      { idempotency_key: idempotencyKey }, '-created_at', 1
    ))[0];
    if (existing) {
      const reconciliation = (await base44.asServiceRole.entities.SeamlessPooledFundsReconciliation.filter(
        { snapshot_id: existing.id }, '-created_at', 1
      ))[0] || null;
      return Response.json({ snapshot: existing, reconciliation, deduplicated: true });
    }

    const providerAvailableBalance = amount(body?.availableBalance, 'available_balance');
    const providerPendingBalance = amount(body?.pendingBalance ?? 0, 'pending_balance');
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

    const now = new Date().toISOString();
    const result = reconcileSeamlessMerchantBalance({
      providerAvailableBalance,
      providerPendingBalance,
      playerAvailableLiability,
      playerHeldLiability,
      pendingDepositAmount,
      reservedWithdrawalAmount,
      uncertainWithdrawalAmount,
      snapshotAsOf: asOf.toISOString(),
      calculatedAt: now,
    });

    const snapshot = await base44.asServiceRole.entities.SeamlessMerchantBalanceSnapshot.create({
      provider_key: 'seamless_ach',
      available_balance: result.provider_available_balance,
      pending_balance: result.provider_pending_balance,
      currency: 'USD',
      as_of: asOf.toISOString(),
      source,
      provider_reference_id: String(body?.providerReferenceId || '').slice(0, 255),
      idempotency_key: idempotencyKey,
      captured_by: admin.id,
      notes: String(body?.notes || '').slice(0, 2000),
      created_at: now,
    });

    const reconciliation = await base44.asServiceRole.entities.SeamlessPooledFundsReconciliation.create({
      snapshot_id: snapshot.id,
      ...result,
      calculation_json: JSON.stringify({
        method: 'merchant_settled_balance_minus_internal_player_liability',
        provider_balance_scope: 'merchant_pool',
        player_balance_scope: 'internal_ledger',
        pending_deposits_informational_only: true,
      }),
      created_by: admin.id,
      created_at: now,
    });

    await recordIntegrationEvent(base44, {
      eventType: 'financial.seamless_merchant_balance_reconciled',
      aggregateType: 'ledger_group',
      aggregateId: reconciliation.id,
      correlationId: snapshot.id,
      idempotencyKey: `seamless:merchant_balance_reconciliation:${idempotencyKey}`,
      actorType: 'administrator',
      actorId: admin.id,
      status: result.status,
      amount: result.settled_coverage_variance,
      result: result.status,
      eventData: {
        snapshot_id: snapshot.id,
        provider_balance_scope: 'merchant_pool',
        player_balance_scope: 'internal_ledger',
      },
    });

    return Response.json({ snapshot, reconciliation, deduplicated: false });
  } catch (error) {
    const code = String(error?.message || 'reconciliation_failed');
    const status = code.startsWith('invalid_') ? 400 : 500;
    return Response.json({ error: code }, { status });
  }
});
