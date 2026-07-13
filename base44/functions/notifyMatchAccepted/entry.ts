import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Provider-agnostic dispatcher for "your match was accepted" notifications.
// Today it sends an email; a future channel (push, SMS, in-app) can be added
// here without any change to the match workflow or matchmaking logic that
// calls this function.
async function sendEmailNotification(base44, match, hostUser) {
  const appUrl = `https://${Deno.env.get('BASE44_APP_ID')}.base44.app`;
  const subject = 'Your ChessBet match has been accepted!';
  const body = `
    <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.6;">
      <p>Your challenge has been accepted and your opponent is ready to play.</p>
      <p>Return to ChessBet to begin your match.</p>
      <p style="margin-top: 24px;">
        <a href="${appUrl}/" style="background: #C9A84C; color: #000; font-weight: bold; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
          Return to ChessBet
        </a>
      </p>
    </div>
  `;
  await base44.asServiceRole.integrations.Core.SendEmail({
    to: hostUser.email,
    subject,
    body,
    from_name: 'ChessBet',
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    // Idempotency + all the conditions under which we must NOT notify.
    if (
      match.accept_notification_sent ||
      !match.notify_on_accept ||
      match.creator_viewed_acceptance ||
      match.status === 'cancelled' ||
      match.status === 'searching'
    ) {
      return Response.json({ skipped: true, match });
    }

    const hostUser = await base44.asServiceRole.entities.User.get(match.player1_id);
    if (!hostUser?.email) {
      return Response.json({ skipped: true, reason: 'no host email' });
    }

    await sendEmailNotification(base44, match, hostUser);

    const updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, {
      accept_notification_sent: true,
    });

    return Response.json({ sent: true, match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});