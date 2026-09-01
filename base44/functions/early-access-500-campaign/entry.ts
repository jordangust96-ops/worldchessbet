import { createClientFromRequest } from 'npm:@base44/sdk';
import { EARLY_ACCESS_MODE, EARLY_ACCESS_STARTING_BALANCE } from '../../shared/earlyAccess.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { requireAdminMfa } from '../../shared/mfa.ts';

const CAMPAIGN_KEY = 'early-access-500-july-2026';
const SUBJECT = 'Your $500 Early Access stack is ready';
const CREDIT_DESCRIPTION = 'Early Access bonus balance — pre-launch testing credit';

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function emailHtml(firstName, loginUrl) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#171717;line-height:1.6;">
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Your ChessBet account has been loaded with $500 in Early Access demo funds.</p>
      <p>Pick a stake, make a challenge, and put your best moves to work. Want a familiar opponent? Invite your friends to sign up, then use a private match to play together.</p>
      <p style="margin:28px 0;"><a href="${loginUrl}" style="display:inline-block;background:#C9A84C;color:#0A0A0A;padding:12px 22px;border-radius:8px;font-weight:700;text-decoration:none;">Log in &amp; Play</a></p>
      <p>Early Access funds are demo funds only: they have no cash value, cannot be withdrawn, and every Early Access balance will reset to $0 when real-money play launches.</p>
      <p>&mdash; The ChessBet Team</p>
    </div>`;
}

async function ensureEarlyAccessCredit(base44, userId) {
  let wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: userId }))[0];
  if (!wallet) {
    wallet = await base44.asServiceRole.entities.Wallet.create({
      user_id: userId, balance: 0, available_balance: 0, held_balance: 0, total_balance: 0,
      total_wagered: 0, total_won: 0, total_deposited: 0, total_withdrawn: 0, early_access_credited: false,
    });
  }

  if (!EARLY_ACCESS_MODE || wallet.early_access_credited) return false;

  const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
    user_id: userId, type: 'deposit', amount: EARLY_ACCESS_STARTING_BALANCE, description: CREDIT_DESCRIPTION,
  });

  await postLedgerLegs(base44, {
    groupId: crypto.randomUUID(),
    walletTransactionId: walletTransaction.id,
    actor: 'system',
    triggerEvent: 'early_access_bonus',
    legs: [
      { ledgerAccount: 'settlement', debit: EARLY_ACCESS_STARTING_BALANCE, credit: 0, transactionType: 'deposit' },
      { ledgerAccount: 'user_account', userId, debit: 0, credit: EARLY_ACCESS_STARTING_BALANCE, transactionType: 'deposit', totalDepositedDelta: EARLY_ACCESS_STARTING_BALANCE },
    ],
  });

  await base44.asServiceRole.entities.Wallet.update(wallet.id, { early_access_credited: true });
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    const body = await req.json();
    const mfaError = await requireAdminMfa(base44, caller, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;
    if (!EARLY_ACCESS_MODE) {
      return Response.json({ error: 'Early Access campaigns are disabled in production-mode testing.' }, { status: 409 });
    }

    let run = (await base44.asServiceRole.entities.CampaignRun.filter({ campaign_key: CAMPAIGN_KEY }))[0];
    if (!run) {
      const users = await base44.asServiceRole.entities.User.list();
      run = await base44.asServiceRole.entities.CampaignRun.create({
        campaign_key: CAMPAIGN_KEY,
        status: 'running',
        recipient_user_ids: users.map((user) => user.id),
        started_at: new Date().toISOString(),
        description: 'One-time $500 Early Access campaign audience snapshot.',
      });
    }

    const loginUrl = `https://${Deno.env.get('BASE44_APP_ID')}.base44.app/login`;
    const stats = { total: run.recipient_user_ids.length, credited: 0, alreadyCredited: 0, sent: 0, skipped: 0, failed: 0 };

    for (const userId of run.recipient_user_ids) {
      const user = await base44.asServiceRole.entities.User.get(userId);
      if (!user?.email) {
        stats.skipped++;
        continue;
      }

      const deliveries = await base44.asServiceRole.entities.CampaignDelivery.filter({ campaign_key: CAMPAIGN_KEY, user_id: user.id });
      const prior = deliveries[0];
      if (prior?.status === 'success' || prior?.status === 'sending') {
        stats.skipped++;
        continue;
      }

      const credited = await ensureEarlyAccessCredit(base44, user.id);
      if (credited) stats.credited++;
      else stats.alreadyCredited++;

      const firstName = (user.full_name || '').trim().split(/\s+/)[0] || 'there';
      const delivery = prior || await base44.asServiceRole.entities.CampaignDelivery.create({
        campaign_key: CAMPAIGN_KEY, user_id: user.id, recipient_email: user.email, subject: SUBJECT, status: 'sending',
      });
      if (prior?.status === 'failed') {
        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'sending', error_message: '' });
      }

      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          subject: SUBJECT,
          body: emailHtml(firstName, loginUrl),
          from_name: 'ChessBet',
        });
        const sentAt = new Date().toISOString();
        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'success', sent_at: sentAt, error_message: '' });
        await base44.asServiceRole.entities.CampaignEmailLog.create({
          campaign_key: CAMPAIGN_KEY, user_id: user.id, recipient_email: user.email, subject: SUBJECT, status: 'success',
        });
        stats.sent++;
      } catch (error) {
        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'failed', error_message: error.message });
        await base44.asServiceRole.entities.CampaignEmailLog.create({
          campaign_key: CAMPAIGN_KEY, user_id: user.id, recipient_email: user.email, subject: SUBJECT, status: 'failed', error_message: error.message,
        });
        stats.failed++;
      }
    }

    const remaining = await base44.asServiceRole.entities.CampaignDelivery.filter({ campaign_key: CAMPAIGN_KEY, status: 'failed' });
    await base44.asServiceRole.entities.CampaignRun.update(run.id, {
      status: remaining.length ? 'complete_with_failures' : 'complete',
      completed_at: new Date().toISOString(),
    });

    return Response.json({ campaignKey: CAMPAIGN_KEY, ...stats, status: remaining.length ? 'complete_with_failures' : 'complete' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
