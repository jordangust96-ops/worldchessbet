import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { postLedgerLegs } from '../../shared/ledger.ts';

// Reusable, generic marketing/promotional email sender for admins. Pass a
// unique campaignKey (so re-running never double-sends or double-tops-up),
// a subject, and htmlBody. Optionally pass ensureMinBalance to top up any
// recipient's wallet up to that floor (non-withdrawable demo credit, posted
// through the same double-entry Internal Ledger as a real deposit) before
// emailing them. Closed accounts (account_state === 'closed') are always
// excluded from the audience.
const TOP_UP_DESCRIPTION = 'Early Access balance top-up — pre-launch testing credit';

async function ensureMinimumBalance(base44, userId, minBalance) {
  let wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: userId }))[0];
  if (!wallet) {
    wallet = await base44.asServiceRole.entities.Wallet.create({
      user_id: userId, balance: 0, available_balance: 0, held_balance: 0, total_balance: 0,
      total_wagered: 0, total_won: 0, total_deposited: 0, total_withdrawn: 0, early_access_credited: false,
    });
  }

  const shortfall = minBalance - (wallet.available_balance || 0);
  if (shortfall <= 0) return false;

  const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
    user_id: userId, type: 'deposit', amount: shortfall, description: TOP_UP_DESCRIPTION,
  });

  await postLedgerLegs(base44, {
    groupId: crypto.randomUUID(),
    walletTransactionId: walletTransaction.id,
    actor: 'system',
    triggerEvent: 'early_access_top_up',
    legs: [
      { ledgerAccount: 'settlement', debit: shortfall, credit: 0, transactionType: 'deposit' },
      { ledgerAccount: 'user_account', userId, debit: 0, credit: shortfall, transactionType: 'deposit', totalDepositedDelta: shortfall },
    ],
  });

  if (!wallet.early_access_credited) {
    await base44.asServiceRole.entities.Wallet.update(wallet.id, { early_access_credited: true });
  }
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin || admin.role !== 'admin') return Response.json({ error: 'Admin access required' }, { status: 403 });

    const { campaignKey, subject, htmlBody, ensureMinBalance } = await req.json();
    if (!campaignKey || !subject || !htmlBody) {
      return Response.json({ error: 'campaignKey, subject, and htmlBody are required' }, { status: 400 });
    }

    const users = await base44.asServiceRole.entities.User.list();
    const audience = users.filter((u) => u.account_state !== 'closed' && u.email);

    const stats = { total: audience.length, toppedUp: 0, sent: 0, skipped: 0, failed: 0 };
    const loginUrl = Deno.env.get('APP_URL') || `https://${Deno.env.get('BASE44_APP_ID')}.base44.app/login`;

    for (const user of audience) {
      const deliveries = await base44.asServiceRole.entities.CampaignDelivery.filter({ campaign_key: campaignKey, user_id: user.id });
      const prior = deliveries[0];
      if (prior?.status === 'success' || prior?.status === 'sending') {
        stats.skipped++;
        continue;
      }

      if (typeof ensureMinBalance === 'number') {
        const toppedUp = await ensureMinimumBalance(base44, user.id, ensureMinBalance);
        if (toppedUp) stats.toppedUp++;
      }

      const delivery = prior || await base44.asServiceRole.entities.CampaignDelivery.create({
        campaign_key: campaignKey, user_id: user.id, recipient_email: user.email, subject, status: 'sending',
      });
      if (prior?.status === 'failed') {
        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'sending', error_message: '' });
      }

      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          subject,
          body: htmlBody
            .replace(/\{\{FIRST_NAME\}\}/g, (user.full_name || '').trim().split(/\s+/)[0] || 'there')
            .replace(/\{\{LOGIN_URL\}\}/g, loginUrl),
          from_name: 'ChessBet',
        });
        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'success', sent_at: new Date().toISOString(), error_message: '' });
        await base44.asServiceRole.entities.CampaignEmailLog.create({
          campaign_key: campaignKey, user_id: user.id, recipient_email: user.email, subject, status: 'success',
        });
        stats.sent++;
      } catch (error) {
        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'failed', error_message: error.message });
        await base44.asServiceRole.entities.CampaignEmailLog.create({
          campaign_key: campaignKey, user_id: user.id, recipient_email: user.email, subject, status: 'failed', error_message: error.message,
        });
        stats.failed++;
      }
    }

    return Response.json({ campaignKey, ...stats });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});