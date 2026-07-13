import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Presence-based "away" detection: the host's client periodically stamps
// User.last_active_at while the app is open (see PresenceHeartbeat.jsx). If
// the host was active within this window, they're still in the app and will
// see the match transition live — no email needed.
const AWAY_THRESHOLD_MS = 45 * 1000;

async function resolveOpponentName(base44Client, opponentId) {
  if (!opponentId) return 'Your opponent';
  try {
    const opponent = await base44Client.asServiceRole.entities.User.get(opponentId);
    if (opponent?.chess_com_username?.trim()) return opponent.chess_com_username.trim();
    if (opponent?.full_name?.trim()) return opponent.full_name.trim().split(' ')[0];
  } catch (e) {
    // fall through to generic label
  }
  return 'Your opponent';
}

function buildEmailBody({ opponentName, wagerAmount, timeControlLabel, appUrl }) {
  return `
    <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.6; max-width: 480px;">
      <p style="color:#C9A84C; font-weight:bold; letter-spacing:1px; text-transform:uppercase; font-size:12px;">ChessBet</p>
      <p>Your opponent has accepted your challenge and is ready to play.</p>
      <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; color:#555;">Opponent</td>
          <td style="padding: 8px 0; text-align:right; font-weight:bold;">${opponentName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color:#555;">Wager</td>
          <td style="padding: 8px 0; text-align:right; font-weight:bold;">$${wagerAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color:#555;">Time Control</td>
          <td style="padding: 8px 0; text-align:right; font-weight:bold;">${timeControlLabel}</td>
        </tr>
      </table>
      <p style="margin-top: 24px;">
        <a href="${appUrl}/" style="background: #C9A84C; color: #000; font-weight: bold; padding: 12px 24px; border-radius: 8px; text-decoration: none; display:inline-block;">
          Play Now
        </a>
      </p>
      <p style="color:#999; font-size:12px; margin-top:16px;">Your active match resumes automatically when you open ChessBet.</p>
    </div>
  `;
}

// Sole writer of accept_notification_sent (idempotency guard). Never invoked
// with player-supplied identity — matchId is looked up server-side and the
// host is always resolved from match.player1_id, so this cannot be spoofed
// into notifying, or suppressing a notification for, the wrong user.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    // Conditions under which we must NOT send, and never retry.
    if (match.accept_notification_sent) {
      return Response.json({ status: 'skipped', reason: 'already_sent' });
    }
    if (!match.notify_on_accept) {
      return Response.json({ status: 'skipped', reason: 'preference_off' });
    }
    if (match.status === 'cancelled' || match.status === 'searching') {
      return Response.json({ status: 'skipped', reason: 'not_applicable' });
    }

    const hostUser = await base44.asServiceRole.entities.User.get(match.player1_id);
    if (!hostUser?.email) {
      return Response.json({ status: 'skipped', reason: 'no_host_email' });
    }

    // Presence check — skip if the host has been active in the app recently.
    if (hostUser.last_active_at) {
      const elapsed = Date.now() - new Date(hostUser.last_active_at).getTime();
      if (elapsed < AWAY_THRESHOLD_MS) {
        return Response.json({ status: 'skipped', reason: 'host_active' });
      }
    }

    const opponentName = await resolveOpponentName(base44, match.player2_id);
    const appUrl = `https://${Deno.env.get('BASE44_APP_ID')}.base44.app`;

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: hostUser.email,
        subject: 'Your ChessBet match has been accepted!',
        body: buildEmailBody({
          opponentName,
          wagerAmount: match.wager_amount,
          timeControlLabel: match.display_name || match.time_control,
          appUrl,
        }),
        from_name: 'ChessBet',
      });
    } catch (sendError) {
      // Transient send failure — return a distinct status (still HTTP 200)
      // so the calling workflow can branch on it and retry, without ever
      // marking accept_notification_sent.
      return Response.json({ status: 'failed', error: sendError.message });
    }

    await base44.asServiceRole.entities.Match.update(match.id, {
      accept_notification_sent: true,
    });

    return Response.json({ status: 'sent' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});