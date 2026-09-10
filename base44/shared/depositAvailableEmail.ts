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

function easternDate(value: unknown) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date) + ' ET';
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
      event: 'deposit_available_email_log_failed',
      wallet_transaction_id: data?.description || '',
      error: String(error?.message || 'email_log_failed').slice(0, 128),
    }));
  }
}

export async function sendDepositAvailableEmail(base44: any, transaction: any) {
  const fresh = await base44.asServiceRole.entities.WalletTransaction.get(transaction.id);
  if (
    !fresh ||
    fresh.type !== 'deposit' ||
    fresh.status !== 'completed' ||
    fresh.deposit_hold_status !== 'released'
  ) {
    return { skipped: true, reason: 'deposit_not_available' };
  }

  if (fresh.deposit_available_email_status === 'sent') {
    return { alreadySent: true };
  }

  const attempts = Number(fresh.deposit_available_email_attempts || 0);
  if (attempts >= MAX_ATTEMPTS) {
    return { skipped: true, reason: 'attempt_limit_reached' };
  }

  const eventKey = `deposit-available-email:${fresh.id}`;
  const providerLockKey = `deposit-available-email:${fresh.id}`;
  const owner = crypto.randomUUID();
  const claim = await claimWebhookEvent(eventKey, providerLockKey, owner);

  if (claim?.claim === 'completed') {
    if (fresh.deposit_available_email_status !== 'sent') {
      await base44.asServiceRole.entities.WalletTransaction.update(fresh.id, {
        deposit_available_email_status: 'sent',
        deposit_available_email_last_error: '',
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
    deposit_available_email_status: 'processing',
    deposit_available_email_attempts: nextAttempt,
    deposit_available_email_next_attempt_at: processingUntil,
    deposit_available_email_last_error: '',
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
    const totalBalance = usd(wallet.total_balance);
    const availableBalance = usd(wallet.available_balance);
    const submittedAt = easternDate(fresh.created_date);
    const availableAt = easternDate(new Date().toISOString());
    const transactionId = escapeHtml(fresh.id);

    subject = `${amount} is now available in your ChessBet wallet`;
    const detailRow = (label: string, value: string, emphasize = false) => `
      <tr>
        <td style="padding:8px 0;color:#8f8f8f;font-size:13px;">${label}</td>
        <td style="padding:8px 0;text-align:right;color:${emphasize ? '#C9A84C' : '#ffffff'};font-size:13px;font-weight:${emphasize ? '800' : '600'};">${value}</td>
      </tr>`;

    const bodyHtml = `
      <p>Hi ${firstName},</p>
      <p>Your bank deposit has cleared and is now available in your ChessBet wallet. You can use these funds to enter an eligible head-to-head match.</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;background:#111111;border:1px solid #242424;border-radius:12px;">
        <tbody>
          ${detailRow('Amount added', escapeHtml(amount), true)}
          ${detailRow('Available', escapeHtml(availableAt))}
          ${detailRow('Submitted', escapeHtml(submittedAt))}
          ${detailRow('Transaction ID', `<span style="font-family:monospace;font-size:11px;">${transactionId}</span>`)}
          ${detailRow('Wallet balance', escapeHtml(totalBalance))}
          ${detailRow('Ready to play', escapeHtml(availableBalance), true)}
        </tbody>
      </table>
      <p>Choose a match that fits your preferred stake and time control, review the contest terms, and take your seat at the board.</p>
      <p style="color:#8f8f8f;font-size:12px;">You can review this deposit at any time from your <a href="${appUrl}/wallet" style="color:#C9A84C;text-decoration:none;">Transaction History</a>.</p>
      <p>Good luck, and play well.</p>
      <p>&mdash; The ChessBet Team</p>
    `;

    const html = buildChessBetEmailHtml({
      appUrl,
      headerTitle: 'Your deposit is ready',
      headerSubtitle: `${amount} is available to play`,
      bodyHtml,
      ctaText: 'Find a Match',
      ctaUrl: `${appUrl}/play`,
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
      deposit_available_email_status: 'sent',
      deposit_available_email_sent_at: sentAt,
      deposit_available_email_next_attempt_at: sentAt,
      deposit_available_email_last_error: '',
    });

    await logEmail(base44, {
      user_id: fresh.user_id,
      recipient_email: recipient,
      email_type: 'deposit_available',
      subject,
      status: 'success',
      description: `Deposit available notification for transaction ${fresh.id}`,
    });

    await recordIntegrationEvent(base44, {
      eventType: 'notification.deposit_available.sent',
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
        email_type: 'deposit_available',
        available_balance: money(wallet.available_balance),
        total_balance: money(wallet.total_balance),
      },
    });

    return { sent: true };
  } catch (error) {
    const safeError = String(error?.message || 'email_send_failed').slice(0, 300);
    try {
      await finishWebhookEvent(eventKey, providerLockKey, owner, 'retryable', 'deposit_available_email_failed');
    } catch {
      // The claim lease expires safely if the atomic store is unavailable.
    }
    await base44.asServiceRole.entities.WalletTransaction.update(fresh.id, {
      deposit_available_email_status: 'failed',
      deposit_available_email_next_attempt_at: retryAt(nextAttempt),
      deposit_available_email_last_error: safeError,
    });
    await logEmail(base44, {
      user_id: fresh.user_id,
      recipient_email: recipient || 'unavailable',
      email_type: 'deposit_available',
      subject: subject || 'ChessBet deposit available',
      status: 'failed',
      error_message: safeError,
      description: `Deposit available notification for transaction ${fresh.id}`,
    });
    console.error(JSON.stringify({
      event: 'deposit_available_email_failed',
      wallet_transaction_id: fresh.id,
      attempt: nextAttempt,
      error: safeError,
    }));
    return { failed: true, retryable: nextAttempt < MAX_ATTEMPTS };
  }
}
