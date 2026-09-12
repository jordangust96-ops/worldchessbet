import { buildChessBetEmailHtml } from './emailTemplate.ts';

// Total number of users who may ever hold the Founding Player badge.
export const FOUNDING_PLAYER_CAP = 250;

// Awards the Founding Player badge to a single user and sends the branded
// notification email (skipped if the user has opted out of marketing email).
// Caller is responsible for checking the 250-user cap before calling this.
// Idempotent: does nothing if the user is already a Founding Player.
export async function awardFoundingPlayerBadge(base44, targetUser, appUrl) {
  if (targetUser.founding_player) {
    return { awarded: false, alreadyAwarded: true };
  }

  const unsubscribeToken = targetUser.marketing_unsubscribe_token || crypto.randomUUID();
  await base44.asServiceRole.entities.User.update(targetUser.id, {
    founding_player: true,
    founding_player_awarded_at: new Date().toISOString(),
    marketing_unsubscribe_token: unsubscribeToken,
  });

  if (targetUser.marketing_email_opt_out) {
    return { awarded: true, emailSent: false, skippedReason: 'opted_out' };
  }

  const firstName = (targetUser.full_name || '').trim().split(' ')[0] || 'there';
  const subject = "You're a ChessBet Founding Player \u265E\uFE0F";
  const unsubscribeUrl = `${appUrl}/unsubscribe?userId=${encodeURIComponent(targetUser.id)}&token=${encodeURIComponent(unsubscribeToken)}`;

  const policies = await base44.asServiceRole.entities.PrivacyPolicyConfig.filter({ policy_type: 'privacy_policy', is_active: true });
  const supportEmail = policies[0]?.support_email || '';

  const bodyHtml = `
    <p>Hi ${firstName},</p>
    <p>Thank you for joining ChessBet! As one of our first 250 players, you're officially a <strong>Founding Player</strong>.</p>
    <p>Your <strong>Founding Player badge</strong> is now on your profile&mdash;a little recognition for being part of our community from the beginning.</p>
    <p>Chess is even better with a friend. Invite someone to join ChessBet, set up a private challenge, and enjoy a game together.</p>
    <p>We're glad you're here. See you across the board!</p>
    <p>&mdash; The ChessBet Team</p>
  `;

  const html = buildChessBetEmailHtml({
    appUrl,
    headerTitle: 'Welcome, Founding Player',
    headerSubtitle: "You're one of our first 250 players",
    bodyHtml,
    ctaText: 'Start Playing',
    ctaUrl: appUrl ? `${appUrl}/play` : undefined,
    supportEmail,
    unsubscribeUrl,
  });

  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: targetUser.email,
      subject,
      body: html,
      from_name: 'ChessBet',
    });

    await base44.asServiceRole.entities.EmailLog.create({
      user_id: targetUser.id,
      recipient_email: targetUser.email,
      email_type: 'founding_player',
      subject,
      status: 'success',
    });

    await base44.asServiceRole.entities.User.update(targetUser.id, { founding_player_email_sent: true });

    return { awarded: true, emailSent: true };
  } catch (sendError) {
    await base44.asServiceRole.entities.EmailLog.create({
      user_id: targetUser.id,
      recipient_email: targetUser.email,
      email_type: 'founding_player',
      subject,
      status: 'failed',
      error_message: sendError.message,
    });

    return { awarded: true, emailSent: false, error: sendError.message };
  }
}