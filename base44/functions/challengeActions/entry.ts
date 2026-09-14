import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { ChallengeError, fail, requireChallengeSession, inspectChallengePlayer } from '../../shared/challengeAccess.ts';
import { VALID_INVITE, challengePath, isChallenge } from '../../shared/challengePolicy.js';
import { resolveChallenge, viewChallenge, createChallenge, listMyChallenges, authorizeChallenge,
  acceptChallenge, cancelChallenge, readyChallenge, finalizeChallengeStart, recoverChallenge,
  pingChallengeCreator, challengeEvent } from '../../shared/challengeLifecycle.ts';
import { takeChallengeRateLimit } from '../../shared/seamlessAtomicStore.ts';

const ACTIONS = new Set(['view', 'create', 'mine', 'readiness', 'authorize', 'accept', 'cancel',
  'ready', 'heartbeat', 'start', 'recover', 'ping', 'save_context', 'context']);

Deno.serve(async (req) => {
  let action = '';
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    action = String(body.action || 'view');
    if (!ACTIONS.has(action)) fail('invalid_action', 'Unknown challenge action.', 400);
    const user = await base44.auth.me().catch(() => null);
    if (action === 'view') {
      // Public capability preview. No login, identity, location, bank call,
      // Match mutation, financial transaction, or opponent claim occurs here.
      const match = await resolveChallenge(base44, body.inviteCode);
      return Response.json(await viewChallenge(base44, match, user));
    }
    await requireChallengeSession(req, base44, user, body.sessionToken);
    if (action === 'create') return Response.json(await createChallenge(base44, user, body));
    if (action === 'mine') return Response.json(await listMyChallenges(base44, user));
    if (action === 'context') {
      const current = await base44.asServiceRole.entities.User.get(user.id);
      if (!VALID_INVITE.test(String(current.challenge_context_code || ''))) return Response.json({ context: null });
      try {
        const match = await resolveChallenge(base44, current.challenge_context_code);
        return Response.json({ context: { ...(await viewChallenge(base44, match, user)),
          inviteCode: current.challenge_context_code, path: challengePath(current.challenge_context_code) } });
      } catch { return Response.json({ context: null }); }
    }
    if (['cancel', 'ready', 'heartbeat', 'start', 'recover'].includes(action)) {
      if (typeof body.matchId !== 'string' || body.matchId.length > 128) fail('invalid_match', 'A match is required.', 400);
      const match = await base44.asServiceRole.entities.Match.get(body.matchId);
      if (!isChallenge(match) || Number(match.launch_epoch) !== 2) fail('unavailable', 'Challenge not available.', 404);
      if (![match.player1_id, match.player2_id, match.challenge_claimant_id].includes(user.id)) fail('forbidden', 'You are not a participant.', 403);
      if (action === 'cancel') return Response.json(await cancelChallenge(base44, user, match.id));
      if (action === 'start') return Response.json(await finalizeChallengeStart(base44, user, match.id));
      if (action === 'recover') return Response.json(await recoverChallenge(base44, match.id));
      return Response.json(await readyChallenge(req, base44, user, match.id, body));
    }
    const match = await resolveChallenge(base44, body.inviteCode);
    if (action === 'readiness') {
      const state = await inspectChallengePlayer(base44, user.id, match);
      return Response.json({ ...state, ...(await viewChallenge(base44, match, user)) });
    }
    if (action === 'save_context') {
      // Save a return destination, never assign player2_id or alter the match.
      if (!await takeChallengeRateLimit(`context:${user.id}`, 20, 3600)) fail('rate_limited', 'Please try again later.', 429);
      await base44.asServiceRole.entities.User.update(user.id, {
        challenge_context_code: body.inviteCode, challenge_context_saved_at: new Date().toISOString(),
      });
      const state = await inspectChallengePlayer(base44, user.id, match);
      await challengeEvent(base44, match, 'setup_started', user.id, state.code || 'ready');
      return Response.json({ saved: true, path: challengePath(body.inviteCode), reserved: false });
    }
    if (action === 'authorize') return Response.json(await authorizeChallenge(req, base44, user, match, body));
    if (action === 'accept') {
      const result = await acceptChallenge(req, base44, user, match, body);
      return Response.json(result, { status: result.processing ? 202 : 200 });
    }
    if (action === 'ping') return Response.json(await pingChallengeCreator(base44, user, match));
    fail('invalid_action', 'Unknown challenge action.', 400);
  } catch (error) {
    if (error instanceof ChallengeError) return Response.json({
      error: error.message, code: error.code, ...error.details,
    }, { status: error.status });
    console.error(JSON.stringify({ event: 'challenge_action_failed', action,
      error: String(error?.message || 'unknown_error').slice(0, 160) }));
    return Response.json({ error: 'This challenge could not be updated. Please try again.', code: 'temporarily_unavailable' }, { status: 503 });
  }
});
