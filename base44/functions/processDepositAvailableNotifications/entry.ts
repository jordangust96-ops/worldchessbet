import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { sendDepositAvailableEmail } from '../../shared/depositAvailableEmail.ts';

const MAX_BATCH = 50;
const MAX_ATTEMPTS = 8;

function due(transaction: any, nowMs: number) {
  if (!['pending', 'failed', 'processing'].includes(String(transaction.deposit_available_email_status || ''))) {
    return false;
  }
  if (Number(transaction.deposit_available_email_attempts || 0) >= MAX_ATTEMPTS) return false;
  const next = Date.parse(transaction.deposit_available_email_next_attempt_at || '');
  return !Number.isFinite(next) || next <= nowMs;
}

// Recovery sweep for transactional deposit-ready emails. The funds-release
// operation remains independent: an email outage can never delay or reverse a
// player's available balance. Only deposits explicitly stamped by the current
// release flow are selected, so legacy released deposits are not emailed.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const statuses = ['pending', 'failed', 'processing'];
    const groups = await Promise.all(statuses.map((notificationStatus) =>
      base44.asServiceRole.entities.WalletTransaction.filter({
        type: 'deposit',
        status: 'completed',
        deposit_hold_status: 'released',
        deposit_available_email_status: notificationStatus,
      }, 'deposit_available_email_next_attempt_at', 200)
    ));

    const nowMs = Date.now();
    const unique = new Map();
    for (const group of groups) {
      for (const transaction of group) unique.set(transaction.id, transaction);
    }
    const candidates = [...unique.values()]
      .filter((transaction) => due(transaction, nowMs))
      .slice(0, MAX_BATCH);

    const summary = {
      considered: unique.size,
      due: candidates.length,
      sent: 0,
      already_sent: 0,
      busy: 0,
      failed: 0,
      skipped: 0,
    };

    for (const transaction of candidates) {
      try {
        const result = await sendDepositAvailableEmail(base44, transaction);
        if (result.sent) summary.sent += 1;
        else if (result.alreadySent) summary.already_sent += 1;
        else if (result.failed) summary.failed += 1;
        else if (result.reason === 'notification_busy') summary.busy += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(JSON.stringify({
          event: 'deposit_available_notification_recovery_failed',
          wallet_transaction_id: transaction.id,
          error: String(error?.message || 'unknown_error').slice(0, 128),
        }));
      }
    }

    return Response.json({ ok: true, ...summary });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'deposit_available_notification_sweep_failed',
      error: String(error?.message || 'unknown_error').slice(0, 128),
    }));
    return Response.json({ error: 'deposit_available_notification_sweep_failed' }, { status: 500 });
  }
});
