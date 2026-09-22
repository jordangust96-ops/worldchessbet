import { claimPayoutCapacity } from './seamlessAtomicStore.ts';
import { withdrawalCents, MONTH_WINDOW_MS } from './withdrawalLimits.js';
import { seamlessRequest, PATH_CHECK_SEND } from './seamlessAch.ts';

// Historical accepted/ambiguous payouts seed the budget after an upgrade or store recovery.
// Pagination is bounded and fails closed rather than silently undercounting.
export async function sendLimitedWithdrawal(base44, transactionId, body, options = {}) {
  let capacity;
  try {
  const cents = withdrawalCents(body.amount);
  const history = [];
  const since = new Date(Date.now() - MONTH_WINDOW_MS).toISOString();
  for (let offset = 0; ; offset += 500) {
    if (offset >= 10000) throw new Error('Payout history requires reconciliation');
    const rows = await base44.asServiceRole.entities.WalletTransaction.filter(
      { type: 'withdrawal' }, 'created_date', 500, offset);
    for (const row of rows) {
      if (row.id === transactionId) continue;
      if (['submitted', 'settled', 'uncertain', 'reversed'].includes(row.integration_status) ||
          (row.integration_status === 'submitting' && Date.parse(row.withdrawal_provider_attempt_at || row.created_date) < Date.now() - 180000)) {
        const amount = Math.round(Number(row.amount) * 100);
        const at = Date.parse(row.withdrawal_provider_attempt_at || row.created_date);
        if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(at)) {
          throw new Error('Payout history requires reconciliation');
        }
        history.push({id: row.id, cents: amount, at});
      }
    }
    if (rows.length < 500) break;
  }
  const capacityKey = options.capacityKey || transactionId;
  capacity = await claimPayoutCapacity(capacityKey, cents, history);
  } catch (cause) {
    const error = new Error('Bank transfers are temporarily unavailable. Your withdrawal was returned to your wallet and no withdrawal fee was charged. Please try again later.');
    error.status = 429;
    error.payoutCapacity = true;
    error.capacityReason = 'capacity_check_unavailable';
    console.error(JSON.stringify({ event: 'withdrawal_capacity_check_failed',
      wallet_transaction_id: transactionId, reason: cause?.coordinationReason || 'validation_or_store_error',
      commands: cause?.coordinationCommands || [] }));
    throw error;
  }
  if (!capacity?.allowed) {
    const error = new Error(capacity?.duplicate
      ? 'This transfer is already being checked. Please check your transaction history before trying again.'
      : 'Bank transfer capacity is currently full. Your money remains in your wallet. Please try again later; no withdrawal fee was charged.');
    // A duplicate election is ambiguous, never authorize a repeat or release its funds.
    error.status = capacity?.duplicate ? 503 : 429;
    error.capacityReason = capacity?.duplicate ? 'capacity_duplicate' : 'capacity_limit';
    error.payoutCapacity = true;
    throw error;
  }
  // Capacity remains consumed for unknown outcomes and provider rejections. This
  // conservative choice cannot re-open capacity for a transfer that may have sent.
  const tx = await base44.asServiceRole.entities.WalletTransaction.get(transactionId).catch(() => null);
  const attemptAt = new Date().toISOString();
  const safeBody = {
    recipient: body?.recipient || '',
    name: body?.name || '',
    amount: body?.amount || '',
    description: body?.description || '',
    label: body?.label || '',
    account: body?.account || '',
    ...(body?.transfer_speed ? { transfer_speed: body.transfer_speed } : {}),
  };
  await base44.asServiceRole.entities.IntegrationEvent.create({
    event_type: 'financial.seamless_withdrawal_request_attempt',
    event_version: 1,
    occurred_at: attemptAt,
    aggregate_type: 'wallet_transaction',
    aggregate_id: transactionId,
    correlation_id: transactionId,
    idempotency_key: `seamless:withdrawal:http-attempt:${transactionId}`,
    actor_type: 'system',
    actor_id: '',
    user_id: tx?.user_id || '',
    wallet_transaction_id: transactionId,
    status: 'attempting',
    amount: Number(body?.amount || 0),
    currency: 'USD',
    event_data_json: JSON.stringify({
      method: 'POST',
      path: PATH_CHECK_SEND,
      request_body: safeBody,
      note: 'Sanitized provider request metadata. No bank account/routing numbers or full secret keys are stored.',
    }),
    delivery_state: 'unconfigured',
    delivery_attempts: 0,
  }).catch(() => null);
  try {
    const data = await seamlessRequest('POST', PATH_CHECK_SEND, body);
    await base44.asServiceRole.entities.IntegrationEvent.create({
      event_type: 'financial.seamless_withdrawal_http_result',
      event_version: 1,
      occurred_at: new Date().toISOString(),
      aggregate_type: 'wallet_transaction',
      aggregate_id: transactionId,
      correlation_id: transactionId,
      idempotency_key: `seamless:withdrawal:http-result:${transactionId}`,
      actor_type: 'system',
      actor_id: '',
      user_id: tx?.user_id || '',
      wallet_transaction_id: transactionId,
      status: 'received',
      amount: Number(body?.amount || 0),
      currency: 'USD',
      event_data_json: JSON.stringify({
        request_body: safeBody,
        ...(data?.__seamlessMeta || {}),
      }),
      delivery_state: 'unconfigured',
      delivery_attempts: 0,
    }).catch(() => null);
    return data;
  } catch (error) {
    await base44.asServiceRole.entities.IntegrationEvent.create({
      event_type: 'financial.seamless_withdrawal_http_result',
      event_version: 1,
      occurred_at: new Date().toISOString(),
      aggregate_type: 'wallet_transaction',
      aggregate_id: transactionId,
      correlation_id: transactionId,
      idempotency_key: `seamless:withdrawal:http-result:${transactionId}`,
      actor_type: 'system',
      actor_id: '',
      user_id: tx?.user_id || '',
      wallet_transaction_id: transactionId,
      status: 'failed',
      amount: Number(body?.amount || 0),
      currency: 'USD',
      event_data_json: JSON.stringify({
        request_body: safeBody,
        ...(error?.seamlessMeta || {}),
        provider_error: error?.providerError || null,
        error_name: error?.name || 'Error',
      }),
      delivery_state: 'unconfigured',
      delivery_attempts: 0,
    }).catch(() => null);
    throw error;
  }
}