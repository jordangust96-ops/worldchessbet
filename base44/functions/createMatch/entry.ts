import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { getPlatformServiceFee, PLATFORM_FEE_SCHEDULE_VERSION, requiresManualFeeApproval } from '../../shared/platformFee.ts';

// Creates a new challenge (public or private). No funds move at creation time
// — the host's Entry Amount is reserved later, together with the joiner's,
// during the shared Preparing Match phase (see acceptMatch / certifyFairPlay
// / lockWager). This keeps hosting and joining perfectly symmetric: every
// player independently certifies Fair Play and reserves funds in the exact
// same screen, regardless of how they found their opponent.

const VALID_TIME_CONTROLS = new Set(['blitz', 'rapid', 'classical']);
const TIME_CONTROL_LABELS = {
  blitz: 'Blitz (3+0)',
  rapid: 'Rapid (10+0)',
  classical: 'Classical (15+0)',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { wagerAmount, timeControl, isPrivate } = await req.json();
    const wager = Number(wagerAmount);
    if (!Number.isFinite(wager) || wager < 5) {
      return Response.json({ error: 'The minimum Contest Entry Amount is $5.00.' }, { status: 400 });
    }
    if (requiresManualFeeApproval(wager)) {
      return Response.json({ error: 'Contest Entry Amounts above $5,000 require manual approval and a separately disclosed Platform Service Fee before acceptance.' }, { status: 400 });
    }
    const platformServiceFee = getPlatformServiceFee(wager);
    if (platformServiceFee === null) {
      return Response.json({ error: 'No published Platform Service Fee applies to this Contest Entry Amount.' }, { status: 400 });
    }
    if (!VALID_TIME_CONTROLS.has(timeControl)) {
      return Response.json({ error: 'Invalid time control' }, { status: 400 });
    }

    // Eligibility — the single shared pipeline (identity, geolocation,
    // participation restrictions, available balance) also used by Join
    // Match. No funds are held here; this is only an early eligibility check.
    const eligibilityRes = await base44.functions.invoke('runContestEligibility', { entryAmount: wager, relatedEntityType: 'match' });
    if (eligibilityRes.data?.error || !eligibilityRes.data?.eligible) {
      return Response.json({ error: eligibilityRes.data?.reason || eligibilityRes.data?.error || 'You are not eligible to create this contest' }, { status: 403 });
    }

    const match = await base44.asServiceRole.entities.Match.create({
      player1_id: user.id,
      wager_amount: wager,
      platform_service_fee: platformServiceFee,
      platform_fee_schedule_version: PLATFORM_FEE_SCHEDULE_VERSION,
      time_control: timeControl,
      display_name: TIME_CONTROL_LABELS[timeControl],
      status: 'searching',
      is_private: !!isPrivate,
      player1_deposited: false,
      player1_certified: false,
      ...(isPrivate ? { invite_code: crypto.randomUUID() } : {}),
    });

    await recordIntegrationEvent(base44, {
      eventType: 'contest.created',
      aggregateType: 'match',
      aggregateId: match.id,
      correlationId: match.id,
      idempotencyKey: `contest.created:${match.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      matchId: match.id,
      status: match.status,
      amount: match.wager_amount,
      result: 'created',
      eventData: {
        player1_id: match.player1_id,
        time_control: match.time_control,
        entry_amount: match.wager_amount,
        platform_service_fee: match.platform_service_fee,
        platform_fee_schedule_version: match.platform_fee_schedule_version,
        is_private: !!match.is_private,
      },
    });

    return Response.json({ match });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});