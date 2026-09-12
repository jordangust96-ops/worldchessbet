import { isLocationTestAccountId, isLocationTestAccount } from './jurisdictionGates.js';
import { getRequestJurisdiction } from './requestJurisdiction.ts';
import { isMatchLocationEvidence } from './matchLocationPolicy.js';

// Called with the original edge Request, never a server-to-server invoke's IP.
// Obtains fresh evidence except for the two owner-authorized testing accounts.
export async function verifyMatchLocation(req, match, context = {}) {
  return await (await getRequestJurisdiction(req, {
    ...context,
    triggerEvent: 'match_readiness',
    relatedEntityType: 'match',
    relatedEntityId: match.id,
  }, { fresh: true, requireLocation: true })).json();
}

// Read-only start gate. Never tries to locate the opponent using the caller's
// IP, and never performs paid lookups from an automatic retry or sweep.
export async function getMatchLocationReadiness(base44, match) {
  const userIds = [match.player1_id, match.player2_id];
  if (!userIds[0] || !userIds[1] || userIds[0] === userIds[1]) {
    return { ready: false, requiredUserIds: userIds.filter(Boolean) };
  }
  const exempt = await Promise.all(userIds.map(async userId =>
    isLocationTestAccountId(userId) && isLocationTestAccount(await base44.asServiceRole.entities.User.get(userId))
  ));
  const latest = await Promise.all(userIds.map((userId, i) => exempt[i] ? [] :
    base44.asServiceRole.entities.JurisdictionVerificationLog.filter(
      { user_id: userId }, '-verified_at', 1
    )
  ));
  const now = Date.now();
  const requiredUserIds = userIds.filter((userId, i) =>
    !exempt[i] && (Deno.env.get('MAXMIND_GEOIP_ENABLED') !== 'true' || !isMatchLocationEvidence(latest[i]?.[0], match, userId, now))
  );
  return { ready: requiredUserIds.length === 0, requiredUserIds };
}

export function matchLocationRequiredResponse(readiness) {
  return Response.json({
    error: 'Both players need a current location verification before the match can start. Recheck your location to continue.',
    action: 'match_location_required',
    requiredUserIds: readiness.requiredUserIds,
  }, { status: 403 });
}
