import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Reusable marketing email sender for admins. Wallet adjustments are not a
// supported campaign feature; campaign delivery is email-only and idempotent.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin || admin.role !== 'admin') return Response.json({ error: 'Admin access required' }, { status: 403 });

    const { campaignKey, subject, htmlBody, ensureMinBalance } = await req.json();
    if (!campaignKey || !subject || !htmlBody) {
      return Response.json({ error: 'campaignKey, subject, and htmlBody are required' }, { status: 400 });
    }
    if (ensureMinBalance !== undefined) {
      return Response.json({ error: 'Promotional wallet adjustments are not supported.' }, { status: 409 });
    }

    const users = await base44.asServiceRole.entities.User.list();
    const audience = users.filter((u) => u.account_state !== 'closed' && u.email);
    const stats = { total: audience.length, sent: 0, skipped: 0, failed: 0 };
    const loginUrl = Deno.env.get('APP_URL') || `https://${Deno.env.get('BASE44_APP_ID')}.base44.app/login`;

    for (const user of audience) {
      const deliveries = await base44.asServiceRole.entities.CampaignDelivery.filter({ campaign_key: campaignKey, user_id: user.id });
      const prior = deliveries[0];
      if (prior?.status === 'success' || prior?.status === 'sending') {
        stats.skipped++;
        continue;
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
