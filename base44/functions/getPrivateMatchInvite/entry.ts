import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Resolves a private invitation without exposing all searching private matches
// through client-side Match reads. The invite code is a capability token; only
// the minimum details needed to render the confirmation screen are returned.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { inviteCode } = await req.json();
    if (typeof inviteCode !== 'string' || inviteCode.length < 16 || inviteCode.length > 128) {
      return Response.json({ error: 'This invitation is not available' }, { status: 404 });
    }

    const matches = await base44.asServiceRole.entities.Match.filter(
      { launch_epoch: 2, invite_code: inviteCode },
      '-created_date',
      2
    );
    const match = matches?.[0];

    if (!match || !match.is_private) {
      return Response.json({ error: 'This invitation is not available' }, { status: 404 });
    }

    const isParticipant = match.player1_id === user.id || match.player2_id === user.id;
    if (isParticipant) {
      return Response.json({
        participant: true,
        matchId: match.id,
        status: match.status,
      });
    }

    if (match.status !== 'searching' || match.player2_id) {
      return Response.json({ error: 'This invitation is no longer available' }, { status: 410 });
    }

    let hostName = 'Host';
    try {
      const host = await base44.asServiceRole.entities.User.get(match.player1_id);
      hostName =
        host?.chess_com_username?.trim() ||
        host?.full_name?.trim() ||
        'Host';
    } catch {
      // A display name is optional; never block a valid invitation on it.
    }

    return Response.json({
      participant: false,
      hostName,
      match: {
        id: match.id,
        wager_amount: match.wager_amount,
        platform_service_fee: match.platform_service_fee,
        platform_fee_schedule_version: match.platform_fee_schedule_version,
        time_control: match.time_control,
        display_name: match.display_name,
        status: match.status,
        is_private: true,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Unable to load this invitation' },
      { status: 500 }
    );
  }
});
