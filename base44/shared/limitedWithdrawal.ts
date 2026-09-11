import { claimPayoutCapacity } from './seamlessAtomicStore.ts';
import { withdrawalCents, MONTH_WINDOW_MS } from './withdrawalLimits.js';
import { seamlessRequest, PATH_CHECK_SEND } from './seamlessAch.ts';

// Historical accepted/ambiguous payouts seed the budget after an upgrade or store recovery.
// Pagination is bounded and fails closed rather than silently undercounting.
export async function sendLimitedWithdrawal(base44, transactionId, body) {
  let capacity;
  try {
  const cents = withdrawalCents(body.amount);
  const history = [];
  const since = new Date(Date.now() - MONTH_WINDOW_MS).toISOString();
  for (let offset = 0; ; offset += 500) {
    if (offset >= 10000) throw new Error('Payout history requires reconciliation');
    const rows = await base44.asServiceRole.entities.WalletTransaction.filter(
      { type: 'withdrawal', created_date: { $gte: since } }, 'created_date', 500, offset);
    for (const row of rows) {
      if (row.id === transactionId) continue;
      if (['submitted', 'settled', 'uncertain', 'reversed'].includes(row.integration_status) ||
          (row.integration_status === 'submitting' && Date.parse(row.created_date) < Date.now() - 180000)) {
        const amount = Math.round(Number(row.amount) * 100);
        const at = Date.parse(row.created_date);
        if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(at)) {
          throw new Error('Payout history requires reconciliation');
        }
        history.push({id: row.id, cents: amount, at});
      }
    }
    if (rows.length < 500) break;
  }
  capacity = await claimPayoutCapacity(transactionId, cents, history);
  } catch {
    const error = new Error('Bank transfers are temporarily unavailable. Your withdrawal was returned to your wallet and no withdrawal fee was charged. Please try again later.');
    error.status = 429;
    error.payoutCapacity = true;
    throw error;
  }
  if (!capacity?.allowed) {
    const error = new Error(capacity?.duplicate
      ? 'This transfer is already being checked. Please check your transaction history before trying again.'
      : 'Bank transfer capacity is currently full. Your money remains in your wallet. Please try again later; no withdrawal fee was charged.');
    // A duplicate election is ambiguous, never authorize a repeat or release its funds.
    error.status = capacity?.duplicate ? 503 : 429;
    error.payoutCapacity = true;
    throw error;
  }
  // Capacity remains consumed for unknown outcomes and provider rejections. This
  // conservative choice cannot re-open capacity for a transfer that may have sent.
  return seamlessRequest('POST', PATH_CHECK_SEND, body);
}
