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

  await base44.asServiceRole.entities.User.update(targetUser.id, {
    founding_player: true,
    founding_player_awarded_at: new Date().toISOString(),
  });

  if (targetUser.marketing_email_opt_out) {
    return { awarded: true, emailSent: false, skippedReason: 'opted_out' };
  }

  const firstName = (targetUser.full_name || '').trim().split(' ')[0] || 'there';
  const subject = "You're a ChessBet Founding Player \u265E\uFE0F";
  const unsubscribeUrl = `${appUrl}/unsubscribe?userId=${targetUser.id}`;

  const policies = await base44.asServiceRole.entities.PrivacyPolicyConfig.filter({ policy_type: 'privacy_policy', is_active: true });
  const supportEmail = policies[0]?.support_email || '';

  const bodyHtml = `
    <p>Hi ${firstName},</p>
    <p>We wanted to personally recognize you as one of ChessBet's first 250 players &mdash; a <strong>Founding Player</strong>.</p>
    <p>Founding Player status is our way of saying thank you for joining us early and helping shape ChessBet ahead of our real-money launch. You'll now see a subtle Founding Player badge on your profile.</p>
    <p>As a reminder: the $500 Early Access balance in your wallet is sandbox play money &mdash; it isn't withdrawable, and your balance will reset to $0 when real-money contests launch. You're welcome to add real funds to your wallet at any time in the meantime, with no restriction on the amount.</p>
    <p>Thanks for being part of ChessBet from the beginning.</p>
    <p>&mdash; The ChessBet Team</p>
  `;

  const html = buildChessBetEmailHtml({
    appUrl,
    headerTitle: 'Welcome, Founding Player',
    headerSubtitle: "You're one of our first 250 players",
    bodyHtml,
    ctaText: 'Go to ChessBet',
    ctaUrl: appUrl || undefined,
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