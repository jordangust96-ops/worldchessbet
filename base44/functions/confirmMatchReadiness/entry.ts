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
      await base44.functions.invoke('lockWager', {
        matchId,
        browserGeoPermission,
        browserLatitude,
        browserLongitude,
        browserAccuracyMeters,
        deviceFingerprintHash,
      });
      match = await base44.asServiceRole.entities.Match.get(matchId);
    }

    const certified = isP1 ? match.player1_certified : match.player2_certified;
    const reserved = isP1 ? match.player1_deposited : match.player2_deposited;

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

    return Response.json({ error: message }, { status: safeStatus });
  }
});
