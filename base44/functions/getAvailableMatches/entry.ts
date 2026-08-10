import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { publicAvailableMatchQuery } from '../../shared/marketplaceStats.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Apply the exact same eligibility definition used by the marketplace
    // headline count before limiting the result set. Filtering after a limit
    // could hide valid public challenges behind the viewer's own/private rows.
    const available = await base44.asServiceRole.entities.Match.filter(
      publicAvailableMatchQuery(user.id),
      '-created_date',
      20
    );

    // Games played and win percentage are read directly from the User
    // entity (maintained by settleMatch on every completed match) — never
    // recomputed from Match history here, to keep the marketplace fast.
    const enriched = await Promise.all(
      available.map(async (m) => {
        let name = 'Opponent';
        let gamesPlayed = 0;
        let winPercentage = 0;
        let isFoundingPlayer = false;
        try {
          const opponent = await base44.asServiceRole.entities.User.get(m.player1_id);
          if (opponent?.chess_com_username?.trim()) {
            name = opponent.chess_com_username.trim();
          } else if (opponent?.full_name?.trim()) {
            name = opponent.full_name.trim();
          }
          gamesPlayed = opponent?.games_played || 0;
          winPercentage = opponent?.win_percentage || 0;
          isFoundingPlayer = !!opponent?.founding_player;
        } catch (e) {
          // fallback to default name/stats
        }
        return { ...m, opponentName: name, gamesPlayed, winPercentage, isFoundingPlayer };
      })
    );

    return Response.json({ matches: enriched });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});