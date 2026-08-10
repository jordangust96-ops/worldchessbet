const EVENT_CONTRACT_VERSION = 1;

function safeEventJson(value) {
  try {
    const json = JSON.stringify(value || {});
    return json.length <= 12000 ? json : JSON.stringify({ truncated: true });
  } catch {
    return JSON.stringify({ serialization_error: true });
  }
}

// Append-only, provider-neutral outbox event. This helper intentionally never
// throws into gameplay or money movement: the authoritative Match, Game,
// WalletTransaction, and LedgerEntry records remain the source of truth if the
// optional integration trace cannot be written.
export async function recordIntegrationEvent(base44, {
  eventType,
  aggregateType,
  aggregateId,
  correlationId,
  causationId = '',
  idempotencyKey,
  actorType = 'system',
  actorId = '',
  userId = '',
  counterpartyUserId = '',
  matchId = '',
  gameId = '',
  walletTransactionId = '',
  ledgerGroupId = '',
  disputeCaseId = '',
  status = '',
  amount,
  currency = 'USD',
  result = '',
  eventData = {},
}) {
  try {
    const canonicalCorrelationId =
      correlationId || matchId || walletTransactionId || disputeCaseId || aggregateId;
    const canonicalIdempotencyKey =
      idempotencyKey || `${eventType}:${aggregateType}:${aggregateId}:${canonicalCorrelationId}`;

    const existing = await base44.asServiceRole.entities.IntegrationEvent.filter(
      { idempotency_key: canonicalIdempotencyKey },
      '-created_date',
      1
    );
    if (existing.length > 0) return existing[0];

    const fields = {
      event_type: eventType,
      event_version: EVENT_CONTRACT_VERSION,
      occurred_at: new Date().toISOString(),
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      correlation_id: canonicalCorrelationId,
      causation_id: causationId || '',
      idempotency_key: canonicalIdempotencyKey,
      actor_type: actorType,
      actor_id: actorId || '',
      user_id: userId || '',
      counterparty_user_id: counterpartyUserId || '',
      match_id: matchId || '',
      game_id: gameId || '',
      wallet_transaction_id: walletTransactionId || '',
      ledger_group_id: ledgerGroupId || '',
      dispute_case_id: disputeCaseId || '',
      status: status || '',
      currency,
      result: result || '',
      event_data_json: safeEventJson(eventData),
      delivery_state: 'unconfigured',
      delivery_attempts: 0,
    };
    if (Number.isFinite(Number(amount))) fields.amount = Number(amount);

    return await base44.asServiceRole.entities.IntegrationEvent.create(fields);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'integration_event_write_failed',
      event_type: eventType,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      error: error?.message || 'unknown_error',
    }));
    return null;
  }
}
