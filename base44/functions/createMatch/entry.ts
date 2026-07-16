import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Creates a new challenge (public or private). No funds move at creation time
// — the host's Entry Amount is reserved later, together with the joiner's,
// during the shared Preparing Match phase (see acceptMatch / certifyFairPlay
// / lockWager). This keeps hosting and joining perfectly symmetric: every
// player independently certifies Fair Play and reserves funds in the exact
// same screen, regardless of how they found their opponent.

const VALID_TIME_CONTROLS = new Set(['blitz', 'rapid', 'classical']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { wagerAmount, timeControl, displayName, isPrivate } = await req.json();
    const wager = Number(wagerAmount);
    if (!Number.isFinite(wager) || wager <= 0) {
      return Response.json({ error: 'Invalid entry amount' }, { status: 400 });
    }
    if (!VALID_TIME_CONTROLS.has(timeControl)) {
      return Response.json({ error: 'Invalid time control' }, { status: 400 });
    }

    // Eligibility — the single shared pipeline (identity, geolocation,
    // participation restrictions, available balance) also used by Join
    // Match. No funds are held here; this is only an early eligibility check.
    const eligibilityRes = await base44.functions.invoke('runContestEligibility', { entryAmount: wager });
    if (eligibilityRes.data?.error || !eligibilityRes.data?.eligible) {
      return Response.json({ error: eligibilityRes.data?.reason || eligibilityRes.data?.error || 'You are not eligible to create this contest' }, { status: 403 });
    }

    const match = await base44.asServiceRole.entities.Match.create({
      player1_id: user.id,
      wager_amount: wager,
      time_control: timeControl,
      display_name: displayName,
      status: 'searching',
      is_private: !!isPrivate,
      player1_deposited: false,
      player1_certified: false,
      ...(isPrivate ? { invite_code: crypto.randomUUID() } : {}),
    });

    return Response.json({ match });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});