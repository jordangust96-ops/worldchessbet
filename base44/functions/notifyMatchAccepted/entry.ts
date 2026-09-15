import { buildMatchAcceptedEmail } from '../../shared/matchAcceptedEmail.js';
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

    const hostUser = await base44.asServiceRole.entities.User.get(match.player1_id);
    const record = async (status, reason, error = '') => {
      console.info('match_acceptance_email', { matchId: match.id, status, reason });
      if (!hostUser?.email) return;
      await base44.asServiceRole.entities.EmailLog.create({
        user_id: match.player1_id, recipient_email: hostUser.email,
        email_type: 'match_accepted', match_id: match.id,
        subject: 'Your ChessBet match has been accepted!', status, reason,
        ...(error ? { error_message: String(error).slice(0, 1000) } : {}),
      });
    };
    const skip = async reason => {
      await record('skipped', reason);
      return Response.json({ status: 'skipped', reason });
    };
    // Conditions under which we must NOT send, and never retry.
    if (match.accept_notification_sent) {
      return Response.json({ status: 'skipped', reason: 'already_sent' });
    }
    if (match.notify_on_accept === false) {
      return await skip('preference_off');
    }
    if (!['preparing','both_ready'].includes(match.status) || !match.player2_id || (isChallenge(match) && challengeStartExpired(match))) {
      return await skip(['in_progress','settling','completed'].includes(match.status) ? 'play_already_started' : match.status === 'cancelled' ? 'cancelled' : 'not_applicable');
    }

    if (!hostUser?.email) {
      return await skip('no_host_email');
    }

    // Recover a provider-accepted receipt if its Match marker write failed.
    const receipts = await base44.asServiceRole.entities.EmailLog.filter({
      email_type: 'match_accepted', match_id: match.id, status: 'success',
    }, '-created_date', 1);
    if (receipts.length) {
      await base44.asServiceRole.entities.Match.update(match.id, { accept_notification_sent: true });
      return Response.json({ status: 'skipped', reason: 'already_sent' });
    }
    const opponentName = await resolveOpponentName(base44, match.player2_id);
    const appUrl = (Deno.env.get('APP_URL') || 'https://worldchessbet.com').replace(/\/$/, '');

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: hostUser.email,
        subject: 'Your ChessBet match has been accepted!',
        body: buildMatchAcceptedEmail({
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
      await record('failed', 'provider_error', sendError.message).catch(() => {});
      return Response.json({ status: 'failed', reason: 'provider_error', error: sendError.message });
    }

    // Once SendEmail succeeds, do not tell the workflow to send again solely
    // because an audit/marker write failed. Attempt both independent records.
    await record('success', 'provider_accepted').catch(() => {
      console.error('match_acceptance_email', { matchId: match.id, reason: 'receipt_write_failed' });
    });
    await base44.asServiceRole.entities.Match.update(match.id, {
      accept_notification_sent: true,
    }).catch(() => {
      console.error('match_acceptance_email', { matchId: match.id, reason: 'sent_marker_write_failed' });
    });

    return Response.json({ status: 'sent' });
  } catch (error) {
    // Return the retry contract expected by the acceptance workflow.
    console.error('match_acceptance_email', { matchId: lockId.replace('accept-notification:', ''), status: 'failed', reason: 'notification_error' });
    return Response.json({ status: 'failed', reason: 'notification_error', error: error.message });
  } finally { if(lockId)await releaseMatchLock(lockId,owner).catch(()=>{}); }
});