import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { requireAdminMfa } from '../../shared/mfa.ts';

const SOURCE_LIMIT = 5000;
const DISPLAY_PAGE_MAX = 100;
const EXPORT_PAGE_MAX = 5000;

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function safeLower(value) {
  return String(value || '').toLowerCase();
}

function uniqueById(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row?.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function latest(rows = []) {
  return [...rows].sort((a, b) => dateMs(b.updated_at || b.updated_date || b.created_at || b.created_date) - dateMs(a.updated_at || a.updated_date || a.created_at || a.created_date))[0] || null;
}

function userLabel(user) {
  return user?.chess_com_username || user?.full_name || user?.email || 'Unknown user';
}

function isUnbalanced(journal) {
  if (!journal) return false;
  return Math.abs(asNumber(journal.total_debit) - asNumber(journal.total_credit)) > 0.000001;
}

function rowFlags({ transaction, journal, ledgerOperation, seamlessOperation, statusRecovery }) {
  const flags = [];
  if (transaction?.status === 'review_required') flags.push('review_required');
  if (['failed', 'reversed'].includes(transaction?.status)) flags.push(transaction.status);
  if (['uncertain', 'failed', 'reversed'].includes(transaction?.integration_status)) flags.push(`integration_${transaction.integration_status}`);
  if (transaction?.deposit_reconciliation_status === 'mismatch') flags.push('deposit_reconciliation_mismatch');
  if (ledgerOperation && ledgerOperation.status !== 'completed') flags.push(`ledger_${ledgerOperation.status}`);
  if (isUnbalanced(journal)) flags.push('unbalanced_journal');
  if (seamlessOperation && ['uncertain', 'failed', 'retryable'].includes(seamlessOperation.status)) flags.push(`seamless_${seamlessOperation.status}`);
  if (statusRecovery && ['retryable_error', 'manual_review', 'failed', 'reversed'].includes(statusRecovery.state)) flags.push(`provider_recovery_${statusRecovery.state}`);
  return [...new Set(flags)];
}

function providerStatus(transaction, seamlessOperation, statusRecovery) {
  return transaction?.provider_last_status || statusRecovery?.provider_status || seamlessOperation?.status || transaction?.integration_status || '—';
}

function transactionOccurredAt(transaction) {
  return transaction?.processed_at || transaction?.created_date || transaction?.updated_date || null;
}

async function loadIndex(service) {
  const safeList = async (entity, sort = '-created_date', limit = SOURCE_LIMIT) => {
    try {
      return await service[entity].list(sort, limit);
    } catch (error) {
      console.error(JSON.stringify({ event: 'admin_ledger_source_load_failed', entity, error: error?.message || 'unknown_error' }));
      return [];
    }
  };

  const [users, transactions, journals, ledgerOperations, seamlessOperations, statusRecoveries, bankAccounts, integrationEvents, settlementEvidence] = await Promise.all([
    safeList('User'),
    safeList('WalletTransaction'),
    safeList('LedgerJournalBatch'),
    safeList('LedgerOperation'),
    safeList('SeamlessOperation', '-updated_at'),
    safeList('SeamlessStatusReconciliation', '-last_checked_at'),
    safeList('SeamlessBankAccount', '-updated_date'),
    safeList('IntegrationEvent', '-occurred_at'),
    safeList('DepositSettlementEvidence', '-recorded_at'),
  ]);

  const userById = new Map(users.map((row) => [row.id, row]));
  const journalByWallet = new Map();
  const journalByGroup = new Map();
  for (const row of journals) {
    if (row.wallet_transaction_id && !journalByWallet.has(row.wallet_transaction_id)) journalByWallet.set(row.wallet_transaction_id, row);
    if (row.ledger_group_id && !journalByGroup.has(row.ledger_group_id)) journalByGroup.set(row.ledger_group_id, row);
  }

  const ledgerOpsByGroup = new Map();
  for (const row of ledgerOperations) {
    if (!row.ledger_group_id) continue;
    const rows = ledgerOpsByGroup.get(row.ledger_group_id) || [];
    rows.push(row);
    ledgerOpsByGroup.set(row.ledger_group_id, rows);
  }

  const seamlessByWallet = new Map();
  for (const row of seamlessOperations) {
    if (!row.wallet_transaction_id) continue;
    const rows = seamlessByWallet.get(row.wallet_transaction_id) || [];
    rows.push(row);
    seamlessByWallet.set(row.wallet_transaction_id, rows);
  }

  const recoveryByWallet = new Map();
  for (const row of statusRecoveries) {
    if (!row.wallet_transaction_id) continue;
    const rows = recoveryByWallet.get(row.wallet_transaction_id) || [];
    rows.push(row);
    recoveryByWallet.set(row.wallet_transaction_id, rows);
  }

  const bankBySource = new Map(bankAccounts.map((row) => [row.source_id, row]));
  const evidenceByWallet = new Map();
  for (const row of settlementEvidence) {
    if (!row.wallet_transaction_id) continue;
    const rows = evidenceByWallet.get(row.wallet_transaction_id) || [];
    rows.push(row);
    evidenceByWallet.set(row.wallet_transaction_id, rows);
  }

  const eventsByWallet = new Map();
  const eventsByGroup = new Map();
  const eventsByCorrelation = new Map();
  for (const event of integrationEvents) {
    if (event.wallet_transaction_id) {
      const rows = eventsByWallet.get(event.wallet_transaction_id) || [];
      rows.push(event);
      eventsByWallet.set(event.wallet_transaction_id, rows);
    }
    if (event.ledger_group_id) {
      const rows = eventsByGroup.get(event.ledger_group_id) || [];
      rows.push(event);
      eventsByGroup.set(event.ledger_group_id, rows);
    }
    if (event.correlation_id) {
      const rows = eventsByCorrelation.get(event.correlation_id) || [];
      rows.push(event);
      eventsByCorrelation.set(event.correlation_id, rows);
    }
  }

  return {
    users,
    transactions,
    journals,
    ledgerOperations,
    seamlessOperations,
    statusRecoveries,
    bankAccounts,
    integrationEvents,
    settlementEvidence,
    userById,
    journalByWallet,
    journalByGroup,
    ledgerOpsByGroup,
    seamlessByWallet,
    recoveryByWallet,
    bankBySource,
    evidenceByWallet,
    eventsByWallet,
    eventsByGroup,
    eventsByCorrelation,
    source_limited: [transactions, journals, ledgerOperations, seamlessOperations, statusRecoveries, integrationEvents].some((rows) => rows.length >= SOURCE_LIMIT),
  };
}

function buildTransactionRow(transaction, index) {
  const user = index.userById.get(transaction.user_id) || null;
  const journal = index.journalByWallet.get(transaction.id) || (transaction.ledger_group_id ? index.journalByGroup.get(transaction.ledger_group_id) : null) || null;
  const ledgerOperation = latest(index.ledgerOpsByGroup.get(transaction.ledger_group_id) || []);
  const seamlessOperation = latest(index.seamlessByWallet.get(transaction.id) || []);
  const statusRecovery = latest(index.recoveryByWallet.get(transaction.id) || []);
  const bank = transaction.funding_source_id ? index.bankBySource.get(transaction.funding_source_id) || null : null;
  const evidence = index.evidenceByWallet.get(transaction.id) || [];
  const events = uniqueById([
    ...(index.eventsByWallet.get(transaction.id) || []),
    ...(transaction.ledger_group_id ? index.eventsByGroup.get(transaction.ledger_group_id) || [] : []),
    ...(transaction.correlation_id ? index.eventsByCorrelation.get(transaction.correlation_id) || [] : []),
  ]);
  const flags = rowFlags({ transaction, journal, ledgerOperation, seamlessOperation, statusRecovery });

  return {
    key: `wallet:${transaction.id}`,
    record_kind: 'wallet_transaction',
    occurred_at: transactionOccurredAt(transaction),
    created_at: transaction.created_date || null,
    processed_at: transaction.processed_at || null,
    transaction_id: transaction.id,
    wallet_transaction_id: transaction.id,
    user_id: transaction.user_id || null,
    user_name: userLabel(user),
    user_email: user?.email || '',
    type: transaction.type || 'unknown',
    amount: asNumber(transaction.amount),
    currency: transaction.currency || 'USD',
    direction: transaction.direction || 'internal',
    status: transaction.status || 'unknown',
    integration_status: transaction.integration_status || '—',
    provider_status: providerStatus(transaction, seamlessOperation, statusRecovery),
    provider_reference_id: seamlessOperation?.provider_reference_id || statusRecovery?.provider_reference_id || null,
    seamless_operation_status: seamlessOperation?.status || null,
    seamless_attempts: seamlessOperation?.attempts ?? null,
    funding_source_id: transaction.funding_source_id || null,
    funding_source_mask: bank?.account_mask || null,
    funding_source_name: bank?.account_name || null,
    ledger_group_id: transaction.ledger_group_id || journal?.ledger_group_id || null,
    ledger_status: ledgerOperation?.status || (journal ? 'committed' : '—'),
    ledger_balanced: journal ? !isUnbalanced(journal) : null,
    ledger_leg_count: journal?.leg_count ?? null,
    correlation_id: transaction.correlation_id || journal?.correlation_id || null,
    match_id: transaction.match_id || journal?.match_id || null,
    source_event: transaction.source_event || journal?.trigger_event || null,
    provider_last_checked_at: transaction.provider_last_checked_at || statusRecovery?.last_checked_at || null,
    deposit_hold_status: transaction.deposit_hold_status || null,
    deposit_release_at: transaction.deposit_release_at || null,
    payout_hold_status: transaction.payout_hold_status || null,
    payout_release_at: transaction.payout_release_at || null,
    reconciliation_status: transaction.deposit_reconciliation_status || null,
    reconciliation_evidence_count: evidence.length,
    integration_event_count: events.length,
    flags,
  };
}

function buildLedgerOnlyRow(journal, index) {
  const ledgerOperation = latest(index.ledgerOpsByGroup.get(journal.ledger_group_id) || []);
  const events = uniqueById([
    ...(index.eventsByGroup.get(journal.ledger_group_id) || []),
    ...(journal.correlation_id ? index.eventsByCorrelation.get(journal.correlation_id) || [] : []),
  ]);
  const flags = [];
  if (ledgerOperation && ledgerOperation.status !== 'completed') flags.push(`ledger_${ledgerOperation.status}`);
  if (isUnbalanced(journal)) flags.push('unbalanced_journal');

  return {
    key: `ledger:${journal.ledger_group_id}`,
    record_kind: 'ledger_batch',
    occurred_at: journal.created_at || journal.created_date || null,
    created_at: journal.created_at || journal.created_date || null,
    processed_at: null,
    transaction_id: journal.ledger_group_id,
    wallet_transaction_id: null,
    user_id: null,
    user_name: 'System ledger',
    user_email: '',
    type: journal.trigger_event || 'ledger_posting',
    amount: asNumber(journal.total_debit),
    currency: journal.currency || 'USD',
    direction: 'internal',
    status: ledgerOperation?.status || 'completed',
    integration_status: '—',
    provider_status: '—',
    provider_reference_id: journal.external_reference_id || null,
    seamless_operation_status: null,
    seamless_attempts: null,
    funding_source_id: null,
    funding_source_mask: null,
    funding_source_name: null,
    ledger_group_id: journal.ledger_group_id,
    ledger_status: ledgerOperation?.status || 'committed',
    ledger_balanced: !isUnbalanced(journal),
    ledger_leg_count: journal.leg_count ?? null,
    correlation_id: journal.correlation_id || null,
    match_id: journal.match_id || null,
    source_event: journal.trigger_event || null,
    provider_last_checked_at: null,
    deposit_hold_status: null,
    deposit_release_at: null,
    payout_hold_status: null,
    payout_release_at: null,
    reconciliation_status: null,
    reconciliation_evidence_count: 0,
    integration_event_count: events.length,
    flags,
  };
}

function filterRows(rows, body) {
  const q = safeLower(body?.search).trim();
  const type = String(body?.type || 'all');
  const status = String(body?.status || 'all');
  const providerStatusFilter = String(body?.provider_status || 'all');
  const recordKind = String(body?.record_kind || 'all');
  const userId = String(body?.user_id || '');
  const startMs = body?.date_from ? dateMs(body.date_from) : 0;
  const endMs = body?.date_to ? dateMs(body.date_to) : 0;
  const flaggedOnly = body?.flagged_only === true;

  return rows.filter((row) => {
    if (type !== 'all' && row.type !== type) return false;
    if (status !== 'all' && row.status !== status && row.integration_status !== status && row.ledger_status !== status) return false;
    if (providerStatusFilter !== 'all' && row.provider_status !== providerStatusFilter && row.seamless_operation_status !== providerStatusFilter) return false;
    if (recordKind !== 'all' && row.record_kind !== recordKind) return false;
    if (userId && row.user_id !== userId) return false;
    if (flaggedOnly && !row.flags?.length) return false;

    const when = dateMs(row.occurred_at);
    if (startMs && when < startMs) return false;
    if (endMs && when > endMs) return false;

    if (q) {
      const haystack = [
        row.transaction_id,
        row.wallet_transaction_id,
        row.user_id,
        row.user_name,
        row.user_email,
        row.type,
        row.status,
        row.integration_status,
        row.provider_status,
        row.provider_reference_id,
        row.funding_source_id,
        row.ledger_group_id,
        row.correlation_id,
        row.match_id,
        row.source_event,
      ].map(safeLower).join(' ');
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function buildSummary(rows) {
  let deposits = 0;
  let withdrawals = 0;
  let platformFees = 0;
  let grossMovement = 0;
  let flagged = 0;
  let inFlight = 0;
  for (const row of rows) {
    const amount = Math.abs(asNumber(row.amount));
    if (row.record_kind === 'wallet_transaction') grossMovement += amount;
    if (row.type === 'deposit') deposits += amount;
    if (row.type === 'withdrawal') withdrawals += amount;
    if (row.type === 'service_fee_charge' || row.type === 'withdrawal_fee') platformFees += amount;
    if (row.type === 'service_fee_refund' || row.type === 'withdrawal_fee_refund') platformFees -= amount;
    if (row.flags?.length) flagged += 1;
    if (['pending', 'processing', 'reserved', 'submitting', 'submitted', 'uncertain'].includes(row.status) || ['pending', 'reserved', 'submitting', 'submitted', 'uncertain'].includes(row.integration_status)) inFlight += 1;
  }
  return {
    total_records: rows.length,
    deposits,
    withdrawals,
    platform_fees: Math.max(platformFees, 0),
    gross_wallet_movement: grossMovement,
    flagged_records: flagged,
    in_flight_records: inFlight,
  };
}

async function detailResponse(service, body) {
  let walletTransactionId = String(body?.wallet_transaction_id || '').trim();
  let ledgerGroupId = String(body?.ledger_group_id || '').trim();
  if (!walletTransactionId && !ledgerGroupId) {
    return Response.json({ error: 'wallet_transaction_id_or_ledger_group_id_required' }, { status: 400 });
  }

  let transaction = null;
  if (walletTransactionId) {
    transaction = await service.WalletTransaction.get(walletTransactionId).catch(() => null);
    if (transaction?.ledger_group_id && !ledgerGroupId) ledgerGroupId = transaction.ledger_group_id;
  }

  let journals = ledgerGroupId ? await service.LedgerJournalBatch.filter({ ledger_group_id: ledgerGroupId }, '-created_at', 10).catch(() => []) : [];
  if (!transaction && journals[0]?.wallet_transaction_id) {
    walletTransactionId = journals[0].wallet_transaction_id;
    transaction = await service.WalletTransaction.get(walletTransactionId).catch(() => null);
  }
  if (!ledgerGroupId && transaction?.ledger_group_id) ledgerGroupId = transaction.ledger_group_id;
  if (!journals.length && ledgerGroupId) journals = await service.LedgerJournalBatch.filter({ ledger_group_id: ledgerGroupId }, '-created_at', 10).catch(() => []);

  const [ledgerEntries, ledgerOperations, seamlessOperations, statusRecoveries, evidence, eventByWallet, eventByGroup] = await Promise.all([
    ledgerGroupId ? service.LedgerEntry.filter({ ledger_group_id: ledgerGroupId }, 'ledger_leg_index', 250).catch(() => []) : Promise.resolve([]),
    ledgerGroupId ? service.LedgerOperation.filter({ ledger_group_id: ledgerGroupId }, '-created_at', 50).catch(() => []) : Promise.resolve([]),
    walletTransactionId ? service.SeamlessOperation.filter({ wallet_transaction_id: walletTransactionId }, '-updated_at', 50).catch(() => []) : Promise.resolve([]),
    walletTransactionId ? service.SeamlessStatusReconciliation.filter({ wallet_transaction_id: walletTransactionId }, '-last_checked_at', 50).catch(() => []) : Promise.resolve([]),
    walletTransactionId ? service.DepositSettlementEvidence.filter({ wallet_transaction_id: walletTransactionId }, '-recorded_at', 50).catch(() => []) : Promise.resolve([]),
    walletTransactionId ? service.IntegrationEvent.filter({ wallet_transaction_id: walletTransactionId }, '-occurred_at', 200).catch(() => []) : Promise.resolve([]),
    ledgerGroupId ? service.IntegrationEvent.filter({ ledger_group_id: ledgerGroupId }, '-occurred_at', 200).catch(() => []) : Promise.resolve([]),
  ]);

  const correlationId = transaction?.correlation_id || journals[0]?.correlation_id || null;
  const eventByCorrelation = correlationId ? await service.IntegrationEvent.filter({ correlation_id: correlationId }, '-occurred_at', 200).catch(() => []) : [];
  const integrationEvents = uniqueById([...eventByWallet, ...eventByGroup, ...eventByCorrelation]).sort((a, b) => dateMs(b.occurred_at) - dateMs(a.occurred_at));

  const user = transaction?.user_id ? await service.User.get(transaction.user_id).catch(() => null) : null;
  const bankAccount = transaction?.funding_source_id
    ? (await service.SeamlessBankAccount.filter({ source_id: transaction.funding_source_id }, '-updated_date', 1).catch(() => []))[0] || null
    : null;
  const matchId = transaction?.match_id || journals[0]?.match_id || ledgerEntries.find((row) => row.match_id)?.match_id || null;
  const match = matchId ? await service.Match.get(matchId).catch(() => null) : null;
  const settlementReconciliations = matchId ? await service.SettlementReconciliation.filter({ match_id: matchId }, '-approved_at', 50).catch(() => []) : [];

  const latestSeamless = latest(seamlessOperations);
  const latestRecovery = latest(statusRecoveries);
  const latestLedgerOperation = latest(ledgerOperations);
  const journal = journals[0] || null;

  const sanitizedTransaction = transaction ? {
    id: transaction.id,
    user_id: transaction.user_id || null,
    type: transaction.type || null,
    amount: transaction.amount ?? null,
    currency: transaction.currency || 'USD',
    direction: transaction.direction || null,
    status: transaction.status || null,
    integration_status: transaction.integration_status || null,
    source_event: transaction.source_event || null,
    description: transaction.description || null,
    match_id: transaction.match_id || null,
    correlation_id: transaction.correlation_id || null,
    ledger_group_id: transaction.ledger_group_id || null,
    funding_source_id: transaction.funding_source_id || null,
    ach_authorization_id: transaction.ach_authorization_id || null,
    initiating_actor: transaction.initiating_actor || null,
    initiating_actor_id: transaction.initiating_actor_id || null,
    idempotency_key: transaction.idempotency_key || null,
    created_date: transaction.created_date || null,
    updated_date: transaction.updated_date || null,
    processed_at: transaction.processed_at || null,
    retention_until: transaction.retention_until || null,
    deposit_processing_fee: transaction.deposit_processing_fee ?? null,
    deposit_bank_debit: transaction.deposit_bank_debit ?? null,
    deposit_pricing_version: transaction.deposit_pricing_version || null,
    deposit_reconciliation_status: transaction.deposit_reconciliation_status || null,
    deposit_reconciliation_reason: transaction.deposit_reconciliation_reason || null,
    deposit_hold_status: transaction.deposit_hold_status || null,
    deposit_release_at: transaction.deposit_release_at || null,
    provider_last_status: transaction.provider_last_status || null,
    provider_last_checked_at: transaction.provider_last_checked_at || null,
    payout_hold_status: transaction.payout_hold_status || null,
    payout_release_at: transaction.payout_release_at || null,
  } : null;

  const sanitizedSeamless = seamlessOperations.map((row) => ({
    id: row.id,
    operation_type: row.operation_type,
    amount: row.amount ?? null,
    status: row.status,
    attempts: row.attempts ?? 0,
    provider_reference_id: row.provider_reference_id || null,
    idempotency_key: row.idempotency_key || null,
    reservation_ledger_group_id: row.reservation_ledger_group_id || null,
    settlement_ledger_group_id: row.settlement_ledger_group_id || null,
    last_error_code: row.last_error_code || null,
    created_at: row.created_at || row.created_date || null,
    updated_at: row.updated_at || row.updated_date || null,
  }));

  const sanitizedBank = bankAccount ? {
    source_id: bankAccount.source_id,
    profile_id: bankAccount.profile_id || null,
    provider_user_id: bankAccount.provider_user_id || null,
    account_name: bankAccount.account_name || null,
    account_mask: bankAccount.account_mask || null,
    status: bankAccount.status || null,
    is_primary: bankAccount.is_primary === true,
    rtp_eligible: bankAccount.rtp_eligible === true,
    added_at: bankAccount.added_at || null,
    verified_at: bankAccount.verified_at || null,
    last_provider_event_id: bankAccount.last_provider_event_id || null,
  } : null;

  const timeline = [
    sanitizedTransaction?.created_date && { at: sanitizedTransaction.created_date, label: 'Wallet transaction created', status: sanitizedTransaction.status },
    sanitizedTransaction?.processed_at && { at: sanitizedTransaction.processed_at, label: 'Internal ledger posting completed', status: sanitizedTransaction.status },
    latestSeamless?.created_at && { at: latestSeamless.created_at, label: 'Seamless operation created', status: latestSeamless.status },
    latestSeamless?.updated_at && { at: latestSeamless.updated_at, label: 'Seamless operation updated', status: latestSeamless.status },
    latestRecovery?.last_checked_at && { at: latestRecovery.last_checked_at, label: 'Provider status checked', status: latestRecovery.provider_status || latestRecovery.state },
    sanitizedTransaction?.deposit_release_at && { at: sanitizedTransaction.deposit_release_at, label: 'Deposit availability threshold', status: sanitizedTransaction.deposit_hold_status },
    sanitizedTransaction?.payout_release_at && { at: sanitizedTransaction.payout_release_at, label: 'Payout release threshold', status: sanitizedTransaction.payout_hold_status },
    ...evidence.map((row) => ({ at: row.recorded_at || row.created_date, label: `Deposit ${row.kind} evidence recorded`, status: row.result })),
  ].filter(Boolean).sort((a, b) => dateMs(a.at) - dateMs(b.at));

  const flags = rowFlags({
    transaction,
    journal,
    ledgerOperation: latestLedgerOperation,
    seamlessOperation: latestSeamless,
    statusRecovery: latestRecovery,
  });

  return Response.json({
    generated_at: new Date().toISOString(),
    flags,
    user: user ? { id: user.id, full_name: user.full_name || '', chess_com_username: user.chess_com_username || '', email: user.email || '' } : null,
    transaction: sanitizedTransaction,
    seamless_operations: sanitizedSeamless,
    seamless_status_reconciliations: statusRecoveries,
    funding_source: sanitizedBank,
    journal_batches: journals,
    ledger_entries: ledgerEntries,
    ledger_operations: ledgerOperations,
    integration_events: integrationEvents,
    deposit_settlement_evidence: evidence,
    settlement_reconciliations: settlementReconciliations,
    match: match ? {
      id: match.id,
      status: match.status || null,
      result: match.result || null,
      player1_id: match.player1_id || null,
      player2_id: match.player2_id || null,
      winner_id: match.winner_id || null,
      wager_amount: match.wager_amount ?? null,
      platform_service_fee: match.platform_service_fee ?? null,
      platform_fee_schedule_version: match.platform_fee_schedule_version || null,
      settlement_hold: match.settlement_hold === true,
      created_date: match.created_date || null,
      updated_date: match.updated_date || null,
    } : null,
    timeline,
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    const body = await req.json().catch(() => ({}));
    const mfaError = await requireAdminMfa(base44, admin, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;

    const service = base44.asServiceRole.entities;
    if (body?.mode === 'detail') return await detailResponse(service, body);

    const index = await loadIndex(service);
    const walletRows = index.transactions.map((transaction) => buildTransactionRow(transaction, index));
    const walletIds = new Set(index.transactions.map((row) => row.id));
    const ledgerOnlyRows = index.journals
      .filter((journal) => !journal.wallet_transaction_id || !walletIds.has(journal.wallet_transaction_id))
      .map((journal) => buildLedgerOnlyRow(journal, index));

    const allRows = [...walletRows, ...ledgerOnlyRows].sort((a, b) => dateMs(b.occurred_at) - dateMs(a.occurred_at));
    const filtered = filterRows(allRows, body);
    const page = Math.max(1, Math.floor(asNumber(body?.page, 1)));
    const requestedPageSize = Math.max(1, Math.floor(asNumber(body?.page_size, 50)));
    const pageSize = Math.min(body?.mode === 'export' ? EXPORT_PAGE_MAX : DISPLAY_PAGE_MAX, requestedPageSize);
    const start = (page - 1) * pageSize;
    const rows = filtered.slice(start, start + pageSize);

    return Response.json({
      generated_at: new Date().toISOString(),
      page,
      page_size: pageSize,
      total: filtered.length,
      total_pages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      source_limited: index.source_limited,
      source_limit: SOURCE_LIMIT,
      summary: buildSummary(filtered),
      rows,
      filter_options: {
        types: [...new Set(allRows.map((row) => row.type).filter(Boolean))].sort(),
        statuses: [...new Set(allRows.flatMap((row) => [row.status, row.integration_status, row.ledger_status]).filter((value) => value && value !== '—'))].sort(),
        provider_statuses: [...new Set(allRows.map((row) => row.provider_status).filter((value) => value && value !== '—'))].sort(),
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'get_admin_transaction_ledger_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'Unable to load transaction ledger' }, { status: 500 });
  }
});
