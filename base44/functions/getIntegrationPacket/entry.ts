import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const MAX_ID_LENGTH = 128;
const incomingTypes = new Set(['deposit', 'payout', 'wager_refund', 'service_fee_refund']);

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function normalizeTransaction(transaction, ledgerEntries) {
  const linkedEntries = ledgerEntries.filter((entry) => entry.wallet_transaction_id === transaction.id);
  const linkedGroups = [...new Set(linkedEntries.map((entry) => entry.ledger_group_id).filter(Boolean))];
  const directionByType = {
    deposit: 'credit',
    withdrawal: 'debit',
    wager_lock: 'reserve',
    wager_refund: 'release',
    payout: 'credit',
    service_fee_charge: 'reserve',
    service_fee_refund: 'release',
  };
  return {
    transaction_id: transaction.id,
    user_id: transaction.user_id,
    match_id: transaction.match_id || '',
    type: transaction.type,
    amount: transaction.amount,
    currency: transaction.currency || 'USD',
    direction: transaction.direction || directionByType[transaction.type] || (incomingTypes.has(transaction.type) ? 'credit' : 'debit'),
    status: transaction.status || 'completed',
    correlation_id: transaction.correlation_id || transaction.match_id || transaction.id,
    ledger_group_id: transaction.ledger_group_id || (linkedGroups.length === 1 ? linkedGroups[0] : ''),
    ledger_group_ids: linkedGroups,
    source_event: transaction.source_event || '',
    integration_status: transaction.integration_status || 'legacy_internal_complete',
    idempotency_key: transaction.idempotency_key || `wallet_transaction:${transaction.id}`,
    processed_at: transaction.processed_at || transaction.created_date,
    created_at: transaction.created_date,
    schema_version: transaction.schema_version || 1,
  };
}

function normalizeLedgerEntry(entry) {
  return {
    ledger_entry_id: entry.id,
    ledger_group_id: entry.ledger_group_id,
    wallet_transaction_id: entry.wallet_transaction_id || '',
    user_id: entry.user_id || '',
    match_id: entry.match_id || '',
    game_id: entry.game_id || '',
    correlation_id: entry.correlation_id || entry.match_id || entry.wallet_transaction_id || entry.ledger_group_id,
    ledger_account: entry.ledger_account,
    transaction_type: entry.transaction_type,
    debit_amount: entry.debit_amount || 0,
    credit_amount: entry.credit_amount || 0,
    currency: entry.currency || 'USD',
    initiating_actor: entry.initiating_actor,
    initiating_actor_id: entry.initiating_actor_id || '',
    trigger_event: entry.trigger_event,
    external_reference_type: entry.external_reference_type || 'none',
    external_reference_id: entry.external_reference_id || '',
    resulting_available_balance: entry.resulting_available_balance,
    resulting_held_balance: entry.resulting_held_balance,
    resulting_total_balance: entry.resulting_total_balance,
    created_at: entry.created_date,
    schema_version: entry.schema_version || 1,
  };
}

function summarizeLedgerGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const groupId = entry.ledger_group_id || `ungrouped:${entry.id}`;
    const group = groups.get(groupId) || {
      ledger_group_id: groupId,
      debit_amount: 0,
      credit_amount: 0,
      ledger_entry_ids: [],
      wallet_transaction_ids: [],
    };
    group.debit_amount += Number(entry.debit_amount) || 0;
    group.credit_amount += Number(entry.credit_amount) || 0;
    group.ledger_entry_ids.push(entry.id);
    if (entry.wallet_transaction_id) group.wallet_transaction_ids.push(entry.wallet_transaction_id);
    groups.set(groupId, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    debit_amount: Number(group.debit_amount.toFixed(2)),
    credit_amount: Number(group.credit_amount.toFixed(2)),
    wallet_transaction_ids: [...new Set(group.wallet_transaction_ids)],
    balanced: Math.round(group.debit_amount * 100) === Math.round(group.credit_amount * 100),
  }));
}

function normalizeEvent(event) {
  let data = {};
  try {
    data = JSON.parse(event.event_data_json || '{}');
  } catch {
    data = { parse_error: true };
  }
  return {
    event_id: event.id,
    event_type: event.event_type,
    event_version: event.event_version || 1,
    occurred_at: event.occurred_at || event.created_date,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    correlation_id: event.correlation_id,
    causation_id: event.causation_id || '',
    idempotency_key: event.idempotency_key,
    actor_type: event.actor_type,
    actor_id: event.actor_id || '',
    user_id: event.user_id || '',
    counterparty_user_id: event.counterparty_user_id || '',
    match_id: event.match_id || '',
    game_id: event.game_id || '',
    wallet_transaction_id: event.wallet_transaction_id || '',
    ledger_group_id: event.ledger_group_id || '',
    dispute_case_id: event.dispute_case_id || '',
    status: event.status || '',
    amount: event.amount,
    currency: event.currency || 'USD',
    result: event.result || '',
    delivery_state: event.delivery_state || 'unconfigured',
    data,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { matchId = '', transactionId = '', userId = '', caseId = '' } = await req.json();
    const supplied = [matchId, transactionId, userId, caseId].filter(Boolean);
    if (supplied.length === 0) {
      return Response.json({ error: 'Provide matchId, transactionId, userId, or caseId' }, { status: 400 });
    }
    if (!supplied.every(validId)) {
      return Response.json({ error: 'Invalid identifier' }, { status: 400 });
    }

    let canonicalMatchId = matchId;
    let canonicalUserId = userId;
    let canonicalCaseId = caseId;
    let seedTransaction = null;
    let disputeCase = null;

    if (transactionId) {
      seedTransaction = await base44.asServiceRole.entities.WalletTransaction.get(transactionId);
      canonicalMatchId = canonicalMatchId || seedTransaction.match_id || '';
      canonicalUserId = canonicalUserId || seedTransaction.user_id || '';
    }
    if (caseId) {
      disputeCase = await base44.asServiceRole.entities.DisputeCase.get(caseId);
      canonicalMatchId = canonicalMatchId || disputeCase.match_id || '';
      canonicalUserId = canonicalUserId || disputeCase.reporting_user_id || '';
    }
    const transactionOnlyScope = !!seedTransaction && !canonicalMatchId && !userId && !caseId;

    let match = null;
    let game = null;
    let contestRecord = null;
    if (canonicalMatchId) {
      match = await base44.asServiceRole.entities.Match.get(canonicalMatchId);
      if (match.game_id) {
        game = await base44.asServiceRole.entities.Game.get(match.game_id).catch(() => null);
      } else {
        const games = await base44.asServiceRole.entities.Game.filter({ match_id: canonicalMatchId }, 'created_date', 1);
        game = games[0] || null;
      }
      const contestRecords = await base44.asServiceRole.entities.ContestRecord.filter({ match_id: canonicalMatchId }, '-created_date', 1);
      contestRecord = contestRecords[0] || null;
    }

    let walletTransactions = [];
    let ledgerEntries = [];
    let integrationEvents = [];
    let integrationReferences = [];
    let disputes = [];

    if (canonicalMatchId) {
      [walletTransactions, ledgerEntries, integrationEvents, integrationReferences, disputes] = await Promise.all([
        base44.asServiceRole.entities.WalletTransaction.filter({ match_id: canonicalMatchId }, 'created_date', 500),
        base44.asServiceRole.entities.LedgerEntry.filter({ match_id: canonicalMatchId }, 'created_date', 1000),
        base44.asServiceRole.entities.IntegrationEvent.filter({ match_id: canonicalMatchId }, 'occurred_at', 1000),
        base44.asServiceRole.entities.IntegrationReference.filter({ match_id: canonicalMatchId }, 'created_date', 500),
        base44.asServiceRole.entities.DisputeCase.filter({ match_id: canonicalMatchId }, 'created_date', 100),
      ]);
    } else if (seedTransaction && transactionOnlyScope) {
      walletTransactions = [seedTransaction];
      ledgerEntries = await base44.asServiceRole.entities.LedgerEntry.filter({ wallet_transaction_id: seedTransaction.id }, 'created_date', 100);
      integrationEvents = await base44.asServiceRole.entities.IntegrationEvent.filter({ wallet_transaction_id: seedTransaction.id }, 'occurred_at', 100);
      integrationReferences = await base44.asServiceRole.entities.IntegrationReference.filter({ wallet_transaction_id: seedTransaction.id }, 'created_date', 100);
    } else if (canonicalUserId) {
      const [asPlayer1, asPlayer2, txs, ledger, events, references] = await Promise.all([
        base44.asServiceRole.entities.Match.filter({ player1_id: canonicalUserId }, '-created_date', 100),
        base44.asServiceRole.entities.Match.filter({ player2_id: canonicalUserId }, '-created_date', 100),
        base44.asServiceRole.entities.WalletTransaction.filter({ user_id: canonicalUserId }, '-created_date', 500),
        base44.asServiceRole.entities.LedgerEntry.filter({ user_id: canonicalUserId }, '-created_date', 1000),
        base44.asServiceRole.entities.IntegrationEvent.filter({ user_id: canonicalUserId }, '-occurred_at', 1000),
        base44.asServiceRole.entities.IntegrationReference.filter({ user_id: canonicalUserId }, '-created_date', 500),
      ]);
      walletTransactions = txs;
      ledgerEntries = ledger;
      integrationEvents = events;
      integrationReferences = references;
      const matchIds = [...new Set([...asPlayer1, ...asPlayer2].map((item) => item.id))];
      const [reportedCases, reportingCases] = await Promise.all([
        base44.asServiceRole.entities.DisputeCase.filter({ reported_user_id: canonicalUserId }, '-created_date', 100),
        base44.asServiceRole.entities.DisputeCase.filter({ reporting_user_id: canonicalUserId }, '-created_date', 100),
      ]);
      disputes = [...new Map(
        [...reportedCases, ...reportingCases]
          .filter((item) => !item.match_id || matchIds.includes(item.match_id))
          .map((item) => [item.id, item])
      ).values()];
    }

    if (canonicalCaseId && !disputeCase) {
      disputeCase = await base44.asServiceRole.entities.DisputeCase.get(canonicalCaseId);
    }
    if (disputeCase && !disputes.some((item) => item.id === disputeCase.id)) disputes.push(disputeCase);
    if (seedTransaction && !walletTransactions.some((item) => item.id === seedTransaction.id)) {
      walletTransactions.push(seedTransaction);
    }

    const normalizedLedgerEntries = ledgerEntries.map(normalizeLedgerEntry);
    const ledgerGroups = summarizeLedgerGroups(ledgerEntries);
    const normalizedTransactions = walletTransactions.map((transaction) =>
      normalizeTransaction(transaction, ledgerEntries)
    );

    const participantIds = [
      ...new Set([
        canonicalUserId,
        match?.player1_id,
        match?.player2_id,
        ...walletTransactions.map((transaction) => transaction.user_id),
        ...disputes.flatMap((item) => [item.reporting_user_id, item.reported_user_id]),
      ].filter(Boolean)),
    ];

    const participantRecords = (
      await Promise.all(
        participantIds.map((participantId) =>
          base44.asServiceRole.entities.User.get(participantId).catch(() => null)
        )
      )
    ).filter(Boolean);

    const diagnostics = {
      ledger_groups_balanced: ledgerGroups.every((group) => group.balanced),
      unbalanced_ledger_group_ids: ledgerGroups.filter((group) => !group.balanced).map((group) => group.ledger_group_id),
      transactions_without_ledger_links: normalizedTransactions
        .filter((transaction) => transaction.ledger_group_ids.length === 0)
        .map((transaction) => transaction.transaction_id),
      ledger_entries_without_transaction_links: normalizedLedgerEntries
        .filter((entry) => !entry.wallet_transaction_id)
        .map((entry) => entry.ledger_entry_id),
      unrouted_transaction_ids: normalizedTransactions
        .filter((transaction) => transaction.integration_status === 'unrouted')
        .map((transaction) => transaction.transaction_id),
      provider_reference_count: integrationReferences.length,
      provider_selected: integrationReferences.some((reference) => reference.provider_key && reference.provider_key !== 'unassigned'),
    };

    return Response.json({
      contract: 'chessbet.funds_flow.integration_packet',
      schema_version: 1,
      generated_at: new Date().toISOString(),
      provider_key: 'unassigned',
      canonical_ids: {
        player_ids: participantIds,
        match_id: canonicalMatchId || '',
        game_id: game?.id || match?.game_id || disputeCase?.game_id || '',
        contest_record_id: contestRecord?.id || disputeCase?.contest_record_id || '',
        dispute_case_ids: disputes.map((item) => item.id),
        wallet_transaction_ids: normalizedTransactions.map((item) => item.transaction_id),
        ledger_group_ids: ledgerGroups.map((item) => item.ledger_group_id),
        integration_event_ids: integrationEvents.map((item) => item.id),
      },
      participants: participantRecords.map((participant) => ({
        player_id: participant.id,
        account_state: participant.account_state || 'provisional',
        identity_verification_status: participant.identity_verification_status || 'not_started',
        identity_verified_at: participant.identity_verified_at || '',
        jurisdiction_status: participant.jurisdiction_status || 'unknown',
        jurisdiction_state: participant.current_jurisdiction_state || '',
        jurisdiction_country: participant.current_jurisdiction_country || '',
        jurisdiction_last_verified_at: participant.jurisdiction_last_verified_at || '',
        withdrawal_hold: !!participant.withdrawal_hold,
      })),
      contest: match ? {
        match_id: match.id,
        game_id: game?.id || match.game_id || '',
        player1_id: match.player1_id,
        player2_id: match.player2_id || '',
        status: match.status,
        result: match.result || '',
        winner_id: match.winner_id || game?.winner_id || '',
        entry_amount: match.wager_amount,
        platform_service_fee_per_player: match.platform_service_fee,
        platform_fee_schedule_version: match.platform_fee_schedule_version || '',
        time_control: match.time_control,
        created_at: match.created_date,
        completed_at: match.completed_at || game?.completed_at || '',
        end_reason: game?.end_reason || contestRecord?.outcome_type || '',
      } : null,
      contest_record: contestRecord ? {
        contest_record_id: contestRecord.id,
        match_id: contestRecord.match_id,
        game_id: contestRecord.game_id,
        contest_pool: contestRecord.contest_pool,
        platform_fee_total: contestRecord.platform_fee,
        winner_id: contestRecord.winner_id || '',
        loser_id: contestRecord.loser_id || '',
        winner_payout: contestRecord.winner_payout || 0,
        outcome_type: contestRecord.outcome_type || '',
        settlement_timestamp: contestRecord.settlement_timestamp,
      } : null,
      transactions: normalizedTransactions,
      ledger_entries: normalizedLedgerEntries,
      ledger_groups: ledgerGroups,
      integration_events: integrationEvents.map(normalizeEvent),
      integration_references: integrationReferences.map((reference) => ({
        reference_id: reference.id,
        provider_key: reference.provider_key,
        reference_type: reference.reference_type,
        external_reference_id: reference.external_reference_id,
        internal_entity_type: reference.internal_entity_type,
        internal_entity_id: reference.internal_entity_id,
        correlation_id: reference.correlation_id || '',
        idempotency_key: reference.idempotency_key || '',
        status: reference.status || '',
        effective_at: reference.effective_at || reference.created_date,
      })),
      disputes: disputes.map((item) => ({
        dispute_case_id: item.id,
        case_number: item.case_number,
        match_id: item.match_id || '',
        game_id: item.game_id || '',
        reporting_user_id: item.reporting_user_id,
        reported_user_id: item.reported_user_id || '',
        status: item.status,
        hold_status: item.hold_status || 'none',
        resolution_type: item.resolution_type || '',
        violation_found: item.violation_found === true,
        created_at: item.created_date,
        resolved_at: item.resolution_timestamp || '',
      })),
      diagnostics,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'integration_packet_failed',
      error: error?.message || 'unknown_error',
    }));
    return Response.json({ error: 'Unable to build integration packet' }, { status: 500 });
  }
});
