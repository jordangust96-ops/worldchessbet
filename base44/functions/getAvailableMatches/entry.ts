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
    const available = openMatches.filter((m) => m.player1_id !== user.id);

    const completedMatches = await base44.asServiceRole.entities.Match.filter({ status: 'completed' });

    const enriched = await Promise.all(
      available.map(async (m) => {
        let name = 'Opponent';
        try {
          const opponent = await base44.asServiceRole.entities.User.get(m.player1_id);
          if (opponent?.chess_com_username?.trim()) {
            name = opponent.chess_com_username.trim();
          } else if (opponent?.full_name?.trim()) {
            name = opponent.full_name.trim();
          }
        } catch (e) {
          // fallback to default name
        }
        const gamesPlayed = completedMatches.filter(
          (pm) => pm.player1_id === m.player1_id || pm.player2_id === m.player1_id
        ).length;
        return { ...m, opponentName: name, gamesPlayed };
      })
    );

    return Response.json({ matches: enriched });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});