import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// ---------------------------------------------------------------------------
// Shared ChessBet branded email template.
// Deno functions deploy independently and cannot share local imports, so any
// future automated email (password reset, match accepted, withdrawal
// confirmation, etc.) should copy this same buildChessBetEmailHtml() helper
// into its own function file to keep a consistent, on-brand look.
// ---------------------------------------------------------------------------
function buildChessBetEmailHtml({ appUrl, headerTitle, headerSubtitle, bodyHtml, ctaText, ctaUrl, earlyAccessText, supportEmail }) {
  const gold = '#C9A84C';
  const fontFamily = "'Inter',Arial,Helvetica,sans-serif";
  const logoBlock = `
    <div style="text-align:center;padding:32px 24px 8px;">
      <table role="presentation" align="center" style="margin:0 auto;border-collapse:collapse;">
        <tr>
          <td style="padding-right:8px;vertical-align:middle;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${gold}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/>
              <path d="M5 21h14"/>
            </svg>
          </td>
          <td style="vertical-align:middle;">
            <span style="font-family:${fontFamily};font-size:24px;font-weight:800;color:${gold};letter-spacing:-0.3px;">ChessBet</span>
          </td>
        </tr>
      </table>
    </div>`;

  const footerLinks = `
    <div style="text-align:center;margin-top:16px;">
      <a href="${appUrl}/privacy-policy" style="color:#8a8a8a;font-size:12px;text-decoration:none;margin:0 8px;">Privacy Policy</a>
      <span style="color:#3a3a3a;">&bull;</span>
      <a href="${appUrl}/terms-of-service" style="color:#8a8a8a;font-size:12px;text-decoration:none;margin:0 8px;">Terms of Service</a>
    </div>`;

  return `
  <div style="background:#f2f2f2;padding:32px 12px;font-family:${fontFamily};">
    <div style="max-width:520px;margin:0 auto;background:#0A0A0A;border-radius:16px;overflow:hidden;border:1px solid #1a1a1a;">
      ${logoBlock}
      <div style="text-align:center;padding:0 24px 24px;">
        <h1 style="color:#ffffff;font-size:22px;font-weight:800;margin:0 0 6px;letter-spacing:-0.2px;">${headerTitle}</h1>
        ${headerSubtitle ? `<p style="color:${gold};font-size:14px;font-weight:700;margin:0;">${headerSubtitle}</p>` : ''}
      </div>
      <div style="padding:0 28px 8px;color:#d5d5d5;font-size:14px;line-height:1.7;">
        ${bodyHtml}
      </div>
      ${ctaText && ctaUrl ? `
      <div style="text-align:center;padding:16px 24px 32px;">
        <a href="${ctaUrl}" style="display:inline-block;background:${gold};color:#0A0A0A;font-weight:700;font-size:15px;text-decoration:none;padding:14px 36px;border-radius:12px;">${ctaText}</a>
      </div>` : ''}
      ${earlyAccessText ? `
      <div style="margin:0 20px 24px;padding:14px 16px;background:#151310;border:1px solid #2a2416;border-radius:12px;">
        <p style="color:${gold};font-size:12px;font-weight:700;margin:0 0 4px;letter-spacing:0.5px;text-transform:uppercase;">Early Access</p>
        <p style="color:#a8a29a;font-size:12px;line-height:1.6;margin:0;">${earlyAccessText}</p>
      </div>` : ''}
      <div style="border-top:1px solid #1a1a1a;padding:20px 24px;text-align:center;">
        <p style="color:#666;font-size:11px;margin:0 0 4px;">&copy; ${new Date().getFullYear()} ChessBet. All rights reserved.</p>
        ${supportEmail ? `<p style="color:#666;font-size:11px;margin:0;">Questions? <a href="mailto:${supportEmail}" style="color:${gold};text-decoration:none;">${supportEmail}</a></p>` : ''}
        ${footerLinks}
      </div>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { userId } = await req.json();
    if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

    const user = await base44.asServiceRole.entities.User.get(userId);
    if (!user) return Response.json({ error: 'User not found' }, { status: 404 });

    // Idempotency guard — send at most once per account, even if this
    // function is retried or invoked more than once for the same user.
    if (user.welcome_email_sent) {
      return Response.json({ alreadySent: true });
    }

    const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/$/, '');
    const firstName = (user.full_name || '').trim().split(' ')[0] || 'there';
    const subject = 'Welcome to ChessBet \u265E\uFE0F';

    const policies = await base44.asServiceRole.entities.PrivacyPolicyConfig.filter({ policy_type: 'privacy_policy', is_active: true });
    const supportEmail = policies[0]?.support_email || '';

    const bodyHtml = `
      <p>Hi ${firstName},</p>
      <p>Welcome to ChessBet&mdash;we're glad you're here.</p>
      <p>ChessBet is built for players who believe every game should mean something. Challenge opponents, compete head-to-head, and put your skills to the test.</p>
      <p>As an Early Access member, you can:</p>
      <p style="margin:4px 0;">&#9823; Play competitive matches in Demo Mode</p>
      <p style="margin:4px 0;">&#129309; Create public or private challenges</p>
      <p style="margin:4px 0;">&#128640; Be among the first notified when real-money contests launch</p>
      <p>We're just getting started, and we're excited to have you with us from the beginning.</p>
      <p>See you across the board.</p>
      <p>&mdash; The ChessBet Team</p>
    `;

    const html = buildChessBetEmailHtml({
      appUrl,
      headerTitle: 'Welcome to ChessBet',
      headerSubtitle: 'Wager. Compete. Win.',
      bodyHtml,
      ctaText: 'Start Playing',
      ctaUrl: appUrl || undefined,
      earlyAccessText: "ChessBet is currently operating in Demo Mode while we prepare for our real-money launch. Join the community, play matches, and you'll be among the first notified when real-money wagering becomes available.",
      supportEmail,
    });

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: user.email,
        subject,
        body: html,
        from_name: 'ChessBet',
      });

      await base44.asServiceRole.entities.EmailLog.create({
        user_id: user.id,
        recipient_email: user.email,
        email_type: 'welcome',
        subject,
        status: 'success',
      });

      await base44.asServiceRole.entities.User.update(user.id, { welcome_email_sent: true });

      return Response.json({ sent: true });
    } catch (sendError) {
      // Never block registration on email failure — log for admin review and
      // leave welcome_email_sent as false so a future retry can still send it.
      await base44.asServiceRole.entities.EmailLog.create({
        user_id: user.id,
        recipient_email: user.email,
        email_type: 'welcome',
        subject,
        status: 'failed',
        error_message: sendError.message,
      });

      return Response.json({ sent: false, error: sendError.message });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});