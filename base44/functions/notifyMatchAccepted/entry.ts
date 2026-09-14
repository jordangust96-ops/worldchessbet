import { challengeStartDeadline, isChallenge, challengeStartExpired } from '../../shared/challengePolicy.js';
import { acquireMatchLock, releaseMatchLock } from '../../shared/seamlessAtomicStore.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildEmailBody({ opponentName, wagerAmount, timeControlLabel, appUrl, matchId, deadline, free = false }) {
  const safeOpponentName = escapeHtml(opponentName);
  const safeTimeControlLabel = escapeHtml(timeControlLabel);
  const safeAppUrl = escapeHtml(appUrl);
  return `
    <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.6; max-width: 480px;">
      <p style="color:#C9A84C; font-weight:bold; letter-spacing:1px; text-transform:uppercase; font-size:12px;">ChessBet</p>
      <p>Your challenge has been accepted.</p>
      <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; color:#555;">Opponent</td>
          <td style="padding: 8px 0; text-align:right; font-weight:bold;">${safeOpponentName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color:#555;">${free ? 'Play mode' : 'Entry Amount'}</td>
          <td style="padding: 8px 0; text-align:right; font-weight:bold;">${free ? 'Free play' : '$'+wagerAmount.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color:#555;">Time Control</td>
          <td style="padding: 8px 0; text-align:right; font-weight:bold;">${safeTimeControlLabel}</td>
        </tr>
      </table>
      <p style="margin-top: 24px;">
        <a href="${safeAppUrl}/play?match=${encodeURIComponent(matchId)}" style="background: #C9A84C; color: #000; font-weight: bold; padding: 12px 24px; border-radius: 8px; text-decoration: none; display:inline-block;">
          Play Now
        </a>
      </p>
      <p style="color:#999; font-size:12px; margin-top:16px;">Return before ${escapeHtml(deadline)}. Both players must confirm readiness to start. You can cancel before play starts.</p>
    </div>
  `;
}

// Sole writer of accept_notification_sent (idempotency guard). Never invoked
// with player-supplied identity — matchId is looked up server-side and the
// host is always resolved from match.player1_id, so this cannot be spoofed
// into notifying, or suppressing a notification for, the wrong user.
Deno.serve(async (req) => {
  const owner=crypto.randomUUID();let lockId='';
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    lockId='accept-notification:'+matchId;
    if(!await acquireMatchLock(lockId,owner)){lockId='';return Response.json({status:'failed',reason:'notification_busy'});}
    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    // Conditions under which we must NOT send, and never retry.
    if (match.accept_notification_sent) {
      return Response.json({ status: 'skipped', reason: 'already_sent' });
    }
    if (match.notify_on_accept === false) {
      return Response.json({ status: 'skipped', reason: 'preference_off' });
    }
    if (!['preparing','both_ready'].includes(match.status) || !match.player2_id || (isChallenge(match) && challengeStartExpired(match))) {
      return Response.json({ status: 'skipped', reason: 'not_applicable' });
    }

    const hostUser = await base44.asServiceRole.entities.User.get(match.player1_id);
    if (!hostUser?.email) {
      return Response.json({ status: 'skipped', reason: 'no_host_email' });
    }

    const opponentName = await resolveOpponentName(base44, match.player2_id);
    const appUrl = (Deno.env.get('APP_URL') || 'https://worldchessbet.com').replace(/\/$/, '');

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: hostUser.email,
        subject: 'Your ChessBet match has been accepted!',
        body: buildEmailBody({
          opponentName,
          free: match.play_mode === 'free',
          wagerAmount: match.wager_amount,
          timeControlLabel: match.display_name || match.time_control,
          appUrl, matchId:match.id,
          deadline:new Date(challengeStartDeadline(match)).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}),
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
  } finally { if(lockId)await releaseMatchLock(lockId,owner).catch(()=>{}); }
});