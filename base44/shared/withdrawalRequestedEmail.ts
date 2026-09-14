import { buildChessBetEmailHtml } from './emailTemplate.ts';
import { claimWebhookEvent, finishWebhookEvent } from './seamlessAtomicStore.ts';
import { recordIntegrationEvent } from './integrationEvents.ts';

const MAX_ATTEMPTS = 8;
const RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  48 * 60 * 60 * 1000,
];

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function usd(value: unknown) {
  return money(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function retryAt(attempts: number) {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1);
  return new Date(Date.now() + RETRY_DELAYS_MS[index]).toISOString();
}

async function logEmail(base44: any, data: any) {
  try {
    await base44.asServiceRole.entities.EmailLog.create(data);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'withdrawal_request_email_log_failed',
      wallet_transaction_id: data?.description || '',
      error: String(error?.message || 'email_log_failed').slice(0, 128),
    }));
  }
}

export async function sendWithdrawalRequestedEmail(base44: any, transaction: any) {
  const fresh = await base44.asServiceRole.entities.WalletTransaction.get(transaction.id);
  if (
    !fresh ||
    fresh.type !== 'withdrawal' ||
    !fresh.withdrawal_requested_at ||
    !fresh.withdrawal_estimated_arrival ||
    fresh.withdrawal_request_status === 'preparing'
  ) {
    return { skipped: true, reason: 'deposit_not_available' };
  }

  if (fresh.withdrawal_request_email_status === 'sent') {
    return { alreadySent: true };
  }

  const attempts = Number(fresh.withdrawal_request_email_attempts || 0);
  if (attempts >= MAX_ATTEMPTS) {
    return { skipped: true, reason: 'attempt_limit_reached' };
  }

  const eventKey = `withdrawal-request-email:${fresh.id}`;
  const providerLockKey = `withdrawal-request-email:${fresh.id}`;
  const owner = crypto.randomUUID();
  const claim = await claimWebhookEvent(eventKey, providerLockKey, owner);

  if (claim?.claim === 'completed') {
    if (fresh.withdrawal_request_email_status !== 'sent') {
      await base44.asServiceRole.entities.WalletTransaction.update(fresh.id, {
        withdrawal_request_email_status: 'sent',
        withdrawal_request_email_last_error: '',
      });
    }
    return { alreadySent: true };
  }
  if (claim?.claim !== 'owned') {
    return { skipped: true, reason: 'notification_busy' };
  }

  const nextAttempt = attempts + 1;
  const processingUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await base44.asServiceRole.entities.WalletTransaction.update(fresh.id, {
    withdrawal_request_email_status: 'processing',
    withdrawal_request_email_attempts: nextAttempt,
    withdrawal_request_email_next_attempt_at: processingUntil,
    withdrawal_request_email_last_error: '',
  });

  let recipient = '';
  let subject = '';
  try {
    const [user, wallets, policies] = await Promise.all([
      base44.asServiceRole.entities.User.get(fresh.user_id),
      base44.asServiceRole.entities.Wallet.filter({ user_id: fresh.user_id }),
      base44.asServiceRole.entities.PrivacyPolicyConfig.filter({
        policy_type: 'privacy_policy',
        is_active: true,
      }),
    ]);
    recipient = String(user?.email || '').trim();
    if (!recipient) throw new Error('recipient_email_unavailable');

    const wallet = wallets[0] || {};
    const appUrl = (Deno.env.get('APP_URL') || 'https://worldchessbet.com').replace(/\/$/, '');
    const supportEmail = policies[0]?.support_email || 'hello@worldchessbet.com';
    const firstName = escapeHtml(String(user?.full_name || '').trim().split(/\s+/)[0] || 'there');
    const amount = usd(fresh.amount);

    const arrival = new Date(fresh.withdrawal_estimated_arrival).toLocaleDateString('en-US', {timeZone:'America/New_York',month:'long',day:'numeric',year:'numeric'});
    subject = `We received your ${amount} withdrawal request`;
    const bodyHtml = `
      <p>Hi ${firstName},</p>
      <p>We received your request to withdraw ${escapeHtml(amount)} to your connected bank.</p>
      <p><strong>Estimated arrival: ${escapeHtml(arrival)}</strong></p>
      <p>This is an estimate. Bank processing or additional verification may change the date. You can follow your request in your wallet.</p>
      <p>The ChessBet Team</p>
    `;

    const html = buildChessBetEmailHtml({
      appUrl,
      headerTitle: 'Withdrawal requested',
      headerSubtitle: `${amount} to your bank`,
      bodyHtml,
      ctaText: 'View Wallet',
      ctaUrl: `${appUrl}/wallet`,
      supportEmail,
    });

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: recipient,
      subject,
      body: html,
      from_name: 'ChessBet',
    });

    const sentAt = new Date().toISOString();
    // Complete the durable claim before secondary audit writes. If a later
    // audit write fails, the email must still never be sent a second time.
    await finishWebhookEvent(eventKey, providerLockKey, owner, 'completed');
    await base44.asServiceRole.entities.WalletTransaction.update(fresh.id, {
      withdrawal_request_email_status: 'sent',
      withdrawal_request_email_sent_at: sentAt,
      withdrawal_request_email_next_attempt_at: sentAt,
      withdrawal_request_email_last_error: '',
    });

    await logEmail(base44, {
      user_id: fresh.user_id,
      recipient_email: recipient,
      email_type: 'withdrawal_requested',
      subject,
      status: 'success',
      description: `Withdrawal request notification for transaction ${fresh.id}`,
    });

    await recordIntegrationEvent(base44, {
      eventType: 'notification.withdrawal_request.sent',
      aggregateType: 'wallet_transaction',
      aggregateId: fresh.id,
      correlationId: fresh.id,
      idempotencyKey: eventKey,
      actorType: 'system',
      userId: fresh.user_id,
      walletTransactionId: fresh.id,
      status: 'sent',
      amount: fresh.amount,
      result: 'email_accepted',
      eventData: {
        email_type: 'withdrawal_requested',
        available_balance: money(wallet.available_balance),
        total_balance: money(wallet.total_balance),
      },
    });

    return { sent: true };
  } catch (error) {
    const safeError = String(error?.message || 'email_send_failed').slice(0, 300);
    try {
      await finishWebhookEvent(eventKey, providerLockKey, owner, 'retryable', 'withdrawal_request_email_failed');
    } catch {
      // The claim lease expires safely if the atomic store is unavailable.
    }
    await base44.asServiceRole.entities.WalletTransaction.update(fresh.id, {
      withdrawal_request_email_status: 'failed',
      withdrawal_request_email_next_attempt_at: retryAt(nextAttempt),
      withdrawal_request_email_last_error: safeError,
    });
    await logEmail(base44, {
      user_id: fresh.user_id,
      recipient_email: recipient || 'unavailable',
      email_type: 'withdrawal_requested',
      subject: subject || 'ChessBet withdrawal request',
      status: 'failed',
      error_message: safeError,
      description: `Withdrawal request notification for transaction ${fresh.id}`,
    });
    console.error(JSON.stringify({
      event: 'withdrawal_request_email_failed',
      wallet_transaction_id: fresh.id,
      attempt: nextAttempt,
      error: safeError,
    }));
    return { failed: true, retryable: nextAttempt < MAX_ATTEMPTS };
  }
}