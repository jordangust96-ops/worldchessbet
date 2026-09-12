import { lockWager } from '../../shared/lockWager.ts';
import { verifyMatchLocation } from '../../shared/matchLocation.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Coordinates the existing Fair Play certification and contest-fund
// reservation operations behind one player action. Both underlying functions
// remain the authoritative implementations for their respective records and
// ledger entries. This wrapper is intentionally idempotent: after a partial
// success or lost response, a retry skips whichever step already completed.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      matchId,
      browserGeoPermission,
      browserLatitude,
      browserLongitude,
      browserAccuracyMeters,
      deviceFingerprintHash,
    } = await req.json();

    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    let match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
    if (Number(match.launch_epoch) !== 2) return Response.json({ error: 'Match not available' }, { status: 410 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    if (!['preparing', 'both_ready', 'in_progress'].includes(match.status)) {
      return Response.json({ error: 'This match is not awaiting readiness confirmation' }, { status: 400 });
    }

    const alreadyCertified = isP1 ? match.player1_certified : match.player2_certified;
    if (!alreadyCertified && match.status !== 'in_progress') {
      await base44.functions.invoke('certifyFairPlay', { matchId });
      match = await base44.asServiceRole.entities.Match.get(matchId);
    }

    const alreadyReserved = isP1 ? match.player1_deposited : match.player2_deposited;
    if (!alreadyReserved && match.status !== 'in_progress') {
      const reservation = await lockWager(req, {
        matchId,
        browserGeoPermission,
        browserLatitude,
        browserLongitude,
        browserAccuracyMeters,
        deviceFingerprintHash,
      });
      if (!reservation.ok) return reservation;
      match = await base44.asServiceRole.entities.Match.get(matchId);
    }

    // A funded player can refresh expired location evidence without reserving
    // funds a second time. Only this explicit player request calls MaxMind.
    if (alreadyReserved && match.status !== 'in_progress') {
      const location = await verifyMatchLocation(req, match, {
        browserGeoPermission, browserLatitude, browserLongitude, browserAccuracyMeters, deviceFingerprintHash,
      });
      if (location.status !== 'approved') return Response.json({
        error: location.reason || 'Unable to verify your location.',
        action: 'match_location_required', requiredUserIds: [user.id],
      }, { status: 403 });
    }

    const certified = isP1 ? match.player1_certified : match.player2_certified;
    const reserved = isP1 ? match.player1_deposited : match.player2_deposited;

    if (match.status !== 'in_progress' && match.player1_certified && match.player2_certified &&
        match.player1_deposited && match.player2_deposited) {
      try {
        const finalized = await base44.functions.invoke('finalizeMatchStart', { matchId });
        if (finalized.data?.match) match = finalized.data.match;
      } catch (error) {
        if (error?.response?.data?.action !== 'match_location_required') throw error;
        return Response.json({ match, ready: Boolean(certified && reserved), ...error.response.data });
      }
    }
    return Response.json({
      match,
      ready: Boolean(certified && reserved),
    });
  } catch (error) {
    const status = Number(error?.response?.status);
    const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    const message =
      error?.response?.data?.error ||
      error?.response?.data?.reason ||
      error?.message ||
      'Unable to confirm match readiness';

    return Response.json({ error: message, action: error?.response?.data?.action, requiredUserIds: error?.response?.data?.requiredUserIds }, { status: safeStatus });
  }
});
