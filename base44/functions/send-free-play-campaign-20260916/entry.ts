import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { buildChessBetEmailHtml } from '../../shared/emailTemplate.ts';

const CAMPAIGN_KEY = 'free-play-2026-09-16';
const SUBJECT = 'Play For Free!';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { runId } = await req.json();
    if (!runId) return Response.json({ error: 'runId_required' }, { status: 400 });

    const run = await base44.asServiceRole.entities.CampaignRun.get(runId);
    if (!run || run.campaign_key !== CAMPAIGN_KEY || run.status !== 'running') {
      return Response.json({ error: 'invalid_campaign_run' }, { status: 409 });
    }

    const users = await base44.asServiceRole.entities.User.list();
    const currentUsers = users.filter((u) => u.account_state !== 'closed' && u.email);
    const audience = currentUsers.filter((u) => u.marketing_email_opt_out !== true);
    const appUrl = (Deno.env.get('APP_URL') || 'https://worldchessbet.com').replace(/\/$/, '');
    const playUrl = `${appUrl}/login?redirect=%2Fplay`;

    const stats = { current_users: currentUsers.length, total: audience.length, opted_out: currentUsers.length - audience.length, sent: 0, skipped: 0, failed: 0 };

    for (const user of audience) {
      const priorRows = await base44.asServiceRole.entities.CampaignDelivery.filter({ campaign_key: CAMPAIGN_KEY, user_id: user.id });
      const prior = priorRows[0];
      if (prior?.status === 'success' || prior?.status === 'sending') {
        stats.skipped++;
        continue;
      }

      const delivery = prior || await base44.asServiceRole.entities.CampaignDelivery.create({
        campaign_key: CAMPAIGN_KEY,
        user_id: user.id,
        recipient_email: user.email,
        subject: SUBJECT,
        status: 'sending',
      });

      if (prior?.status === 'failed') {
        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'sending', error_message: '' });
      }

      try {
        let unsubscribeToken = user.marketing_unsubscribe_token || '';
        if (!unsubscribeToken) {
          unsubscribeToken = crypto.randomUUID();
          await base44.asServiceRole.entities.User.update(user.id, { marketing_unsubscribe_token: unsubscribeToken });
        }
        const unsubscribeUrl = `${appUrl}/unsubscribe?userId=${encodeURIComponent(user.id)}&token=${encodeURIComponent(unsubscribeToken)}`;
        const firstName = (user.full_name || '').trim().split(/\s+/)[0] || 'there';

        const bodyHtml = `
          <p style="margin:0 0 16px;">Hi ${firstName},</p>
          <p style="margin:0 0 16px;"><strong style="color:#ffffff;">Did you know you can play for free on ChessBet?</strong></p>
          <p style="margin:0 0 16px;">You don’t need to fund your wallet to start playing. <strong style="color:#C9A84C;">Free Play is live</strong>, and ChessBet’s money-play jurisdiction restrictions do not apply to free games.</p>
          <p style="margin:0 0 10px;color:#ffffff;font-weight:700;">Challenge a friend. Or challenge your followers.</p>
          <p style="margin:0 0 16px;">Create a free challenge and send the challenge link directly to a friend — or post it on social media and invite your followers to take you on.</p>
          <div style="background:#111111;border:1px solid #242424;border-radius:12px;padding:16px 18px;margin:18px 0;">
            <p style="margin:0 0 8px;color:#C9A84C;font-weight:700;">Free Play is especially useful while your wallet is being funded.</p>
            <p style="margin:0;">You can keep playing, sharing challenges, and getting familiar with ChessBet while your deposit clears.</p>
          </div>
          <p style="margin:0 0 8px;">Create your challenge, copy the link, and share it anywhere.</p>
          <p style="margin:0;color:#ffffff;font-weight:700;">Free Play is available now.</p>`;

        const html = buildChessBetEmailHtml({
          appUrl,
          headerTitle: 'PLAY FOR FREE',
          headerSubtitle: 'Challenge a friend. Share your link. Play now.',
          bodyHtml,
          ctaText: 'CREATE A FREE CHALLENGE',
          ctaUrl: playUrl,
          supportEmail: 'hello@worldchessbet.com',
          unsubscribeUrl,
        });

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          subject: SUBJECT,
          body: html,
          from_name: 'ChessBet',
        });

        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'success', sent_at: new Date().toISOString(), error_message: '' });
        await base44.asServiceRole.entities.CampaignEmailLog.create({ campaign_key: CAMPAIGN_KEY, user_id: user.id, recipient_email: user.email, subject: SUBJECT, status: 'success' });
        stats.sent++;
      } catch (error) {
        await base44.asServiceRole.entities.CampaignDelivery.update(delivery.id, { status: 'failed', error_message: error?.message || 'unknown_error' });
        await base44.asServiceRole.entities.CampaignEmailLog.create({ campaign_key: CAMPAIGN_KEY, user_id: user.id, recipient_email: user.email, subject: SUBJECT, status: 'failed', error_message: error?.message || 'unknown_error' });
        stats.failed++;
      }
    }

    await base44.asServiceRole.entities.CampaignRun.update(run.id, {
      status: stats.failed > 0 ? 'complete_with_failures' : 'complete',
      completed_at: new Date().toISOString(),
      recipient_user_ids: audience.map((u) => u.id),
      description: `Play For Free campaign: ${stats.sent} sent, ${stats.skipped} skipped, ${stats.failed} failed, ${stats.opted_out} opted out.`,
    });

    return Response.json({ campaignKey: CAMPAIGN_KEY, subject: SUBJECT, ...stats });
  } catch (error) {
    console.error('free_play_campaign_send_failed', error);
    return Response.json({ error: error?.message || 'unknown_error' }, { status: 500 });
  }
});