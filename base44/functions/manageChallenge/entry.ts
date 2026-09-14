import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { ChallengeError, fail, requireChallengeSession, inspectChallengePlayer } from '../../shared/challengeAccess.ts';
import { resolveChallenge, viewChallenge, createChallenge, listMyChallenges, authorizeChallenge,
  acceptChallenge, cancelChallenge, readyChallenge, finalizeChallengeStart, recoverChallenge,
  pingChallengeCreator, challengeEvent } from '../../shared/challengeLifecycle.ts';
import { CHALLENGE_VERSION, isChallenge, publicChallenge, challengePath } from '../../shared/challengePolicy.js';
import { takeChallengeRateLimit } from '../../shared/seamlessAtomicStore.ts';
import { getOriginalClientIp } from '../../shared/jurisdictionGates.js';
import { sha256Hex } from '../../shared/mfaCore.js';
import { requireAdminMfa } from '../../shared/mfa.ts';

// Do not return service-role Match records verbatim: field-level permissions
// are bypassed in backend functions, including private operation/lease data.
export function safeChallengeMatch(match: any) {
  if (!match) return match;
  const fields = ['id','launch_epoch','player1_id','player2_id','wager_amount','platform_service_fee',
    'platform_fee_schedule_version','time_control','display_name','status','game_id','is_private',
    'player1_certified','player2_certified','player1_deposited','player2_deposited','preparation_started_at',
    'challenge_version','clock_initial_ms','challenge_expires_at','challenge_close_reason',
    'challenge_player1_ready_at','challenge_player2_ready_at','challenge_claimed_at','result','winner_id','completed_at'];
  return Object.fromEntries(fields.filter(key => match[key] !== undefined).map(key => [key, match[key]]));
}
function response(value: any, status = 200) {
  return Response.json(value?.match ? { ...value, match: safeChallengeMatch(value.match) } : value, {
    status, headers: { 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer' },
  });
}

// Enabled only after the source, schema and adversarial checks are complete.
const IMPLEMENTATION_ENABLED = true;
Deno.serve(async (req) => {
  try {
    if (!IMPLEMENTATION_ENABLED) return response({ error:'Challenge invitations are being updated.', action:'temporarily_unavailable' },503);
    if (req.method !== 'POST') return response({ error:'Method not allowed' }, 405);
    const text = await req.text();
    if (text.length > 6000) return response({ error:'Request too large' }, 413);
    let body;
    try { body = JSON.parse(text || '{}'); } catch { return response({ error:'Invalid request' }, 400); }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const action = String(body.action || 'view');
    if (action === 'view') {
      // A preview is public and read-only. No location/identity check, account,
      // funding, slot assignment or contest journal is created here.
      const ip = getOriginalClientIp(req) || 'unknown-edge';
      const bucket = await sha256Hex(`${ip}:${req.headers.get('user-agent') || ''}`);
      if (!await takeChallengeRateLimit(`view:${bucket}`, 180, 60)) return response({ error:'Please try again shortly.' }, 429);
      const match = await resolveChallenge(base44, body.inviteCode);
      const data = await viewChallenge(base44, match, user);
      if (await takeChallengeRateLimit(`view-event:${match.id}:${bucket}`, 1, 3600)) {
        await challengeEvent(base44, match, 'viewed', user?.id || '', 'invitation_view', `${bucket.slice(0,16)}:${Math.floor(Date.now()/3600000)}`);
      }
      return response(data);
    }
    await requireChallengeSession(req, base44, user, body.sessionToken);
    if (action === 'create') return response(await createChallenge(base44, user, body));
    if (action === 'list') return response(await listMyChallenges(base44, user));
    if (action === 'intent') {
      const rows = await base44.asServiceRole.entities.IntegrationEvent.filter({
        event_type:'challenge.funding_intent', user_id:user.id,
        occurred_at:{ $gte:new Date(Date.now()-14*86400000).toISOString() },
      }, '-occurred_at', 1);
      if (!rows[0]?.match_id) return response({ intent:null });
      const saved = await base44.asServiceRole.entities.Match.get(rows[0].match_id).catch(() => null);
      if (!isChallenge(saved)) return response({ intent:null });
      const data = await viewChallenge(base44, saved, user);
      return response({ intent:{ ...data.challenge, inviteCode:saved.invite_code, path:challengePath(saved.invite_code) } });
    }
    if (action === 'admin') {
      const denied = await requireAdminMfa(base44, user, body.sessionToken, req.headers.get('user-agent') || '');
      if (denied) return denied;
      const rows = await base44.asServiceRole.entities.Match.filter({ launch_epoch:2, challenge_version:CHALLENGE_VERSION }, '-created_date', 101);
      const events = await base44.asServiceRole.entities.IntegrationEvent.filter({
        event_type:{ $in:['challenge.viewed','challenge.funding_intent','challenge.claimed','challenge.creator_notified','challenge.released'] },
        occurred_at:{ $gte:new Date(Date.now()-86400000).toISOString() },
      }, '-occurred_at', 501);
      const counts: any = {};
      const seen = new Set();
      for (const event of events.slice(0,500)) {
        if (seen.has(event.idempotency_key)) continue;
        seen.add(event.idempotency_key); counts[event.event_type] = (counts[event.event_type] || 0) + 1;
      }
      return response({ asOf:new Date().toISOString(), truncated:rows.length>100 || events.length>500,
        counts24h:counts, challenges:rows.slice(0,100).map((m: any) => ({
          ...safeChallengeMatch(m), creatorId:m.player1_id, recipientId:m.player2_id || '',
          operationState:m.challenge_operation_state || 'idle', reservationGroupId:m.challenge_reservation_group_id || '',
          releaseGroupId:m.challenge_release_group_id || '', createdAt:m.created_date,
        })) });
    }
    let match;
    if (body.inviteCode) match = await resolveChallenge(base44, body.inviteCode);
    else if (typeof body.matchId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(body.matchId)) {
      match = await base44.asServiceRole.entities.Match.get(body.matchId);
      if (!isChallenge(match) || Number(match.launch_epoch) !== 2) fail('unavailable','This challenge is unavailable.',404);
      if (![match.player1_id,match.player2_id,match.challenge_claimant_id].includes(user.id)) fail('forbidden','A valid invitation is required.',403);
    } else fail('unavailable','A valid invitation is required.',404);

    if (action === 'readiness') {
      if (match.challenge_target_id && match.challenge_target_id !== user.id && match.player1_id !== user.id)
        fail('different_opponent','This rematch is for the previous opponent.',403);
      const state = await inspectChallengePlayer(base44, user.id, match);
      await challengeEvent(base44, match, 'readiness_checked', user.id, state.code || 'funded_ready', state.code || 'ready');
      return response(state);
    }
    if (action === 'remember') {
      await challengeEvent(base44, match, 'funding_intent', user.id, 'context_only', String(Math.floor(Date.now()/3600000)));
      return response({ remembered:true, reserved:false });
    }
    if (action === 'authorize') return response(await authorizeChallenge(req,base44,user,match,body));
    if (action === 'accept') {
      const result = await acceptChallenge(req,base44,user,match,body);
      return response(result, result.processing ? 202 : 200);
    }
    if (action === 'cancel') return response(await cancelChallenge(base44,user,match.id));
    if (action === 'ready' || action === 'heartbeat') return response(await readyChallenge(req,base44,user,match.id,body));
    if (action === 'finalize') return response(await finalizeChallengeStart(base44,user,match.id));
    if (action === 'recover') {
      if (![match.player1_id,match.player2_id,match.challenge_claimant_id].includes(user.id)) fail('forbidden','Only participants may recover this challenge.',403);
      return response(await recoverChallenge(base44,match.id));
    }
    if (action === 'ping') return response(await pingChallengeCreator(base44,user,match));
    return response({ error:'Unknown challenge action' },400);
  } catch (error) {
    if (error instanceof ChallengeError) return response({ error:error.message, code:error.code, action:error.code, ...error.details },error.status);
    console.error(JSON.stringify({ event:'challenge_request_failed', error:String(error?.message || 'unknown').slice(0,160) }));
    return response({ error:'This challenge could not be updated. Please retry; do not start another payment.', action:'retry' },503);
  }
});