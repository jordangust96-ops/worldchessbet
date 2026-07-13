import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const openMatches = await base44.asServiceRole.entities.Match.filter(
      { status: 'searching' },
      '-created_date',
      20
    );
    // Private matches are only discoverable via their invite link — never
    // surfaced in the public marketplace or its refreshes.
    const available = openMatches.filter((m) => m.player1_id !== user.id && !m.is_private);

    // Games played and win percentage are read directly from the User
    // entity (maintained by settleMatch on every completed match) — never
    // recomputed from Match history here, to keep the marketplace fast.
    const enriched = await Promise.all(
      available.map(async (m) => {
        let name = 'Opponent';
        let gamesPlayed = 0;
        let winPercentage = 0;
        try {
          const opponent = await base44.asServiceRole.entities.User.get(m.player1_id);
          if (opponent?.chess_com_username?.trim()) {
            name = opponent.chess_com_username.trim();
          } else if (opponent?.full_name?.trim()) {
            name = opponent.full_name.trim();
          }
          gamesPlayed = opponent?.games_played || 0;
          winPercentage = opponent?.win_percentage || 0;
        } catch (e) {
          // fallback to default name/stats
        }
        return { ...m, opponentName: name, gamesPlayed, winPercentage };
      })
    );

    return Response.json({ matches: enriched });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});