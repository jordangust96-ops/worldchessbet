import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Records browser focus/visibility changes as supporting game telemetry.
// It is deliberately not authoritative: it never changes clocks, legal moves,
// results, settlement, or account state.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { gameId, eventType } = await req.json();
    if (!gameId || !['hidden', 'visible', 'blur', 'focus'].includes(eventType)) {
      return Response.json({ error: 'A valid gameId and eventType are required' }, { status: 400 });
    }

    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!game || game.status !== 'active') return Response.json({ ignored: true });

    const match = await base44.asServiceRole.entities.Match.get(game.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const color = match.player1_id === user.id ? 'w' : match.player2_id === user.id ? 'b' : null;
    if (!color) return Response.json({ error: 'You are not a player in this match' }, { status: 403 });

    const lostAtField = color === 'w' ? 'white_focus_lost_at' : 'black_focus_lost_at';
    const countField = color === 'w' ? 'white_focus_loss_count' : 'black_focus_loss_count';
    const totalField = color === 'w' ? 'white_total_focus_lost_ms' : 'black_total_focus_lost_ms';
    const now = new Date();
    const currentlyLostAt = game[lostAtField];
    const isLossEvent = eventType === 'hidden' || eventType === 'blur';
    const isReturnEvent = eventType === 'visible' || eventType === 'focus';

    // Deduplicate browser events: tab hiding normally also fires blur, and
    // tab return normally fires both visible and focus.
    if ((isLossEvent && currentlyLostAt) || (isReturnEvent && !currentlyLostAt)) {
      return Response.json({ ignored: true });
    }

    const updates: Record<string, unknown> = {
      focus_log: [...(game.focus_log || []), { color, event_type: eventType, timestamp: now.toISOString() }].slice(-100),
    };

    if (isLossEvent) {
      updates[lostAtField] = now.toISOString();
      updates[countField] = (game[countField] || 0) + 1;
    } else {
      const lostAtMs = new Date(currentlyLostAt).getTime();
      updates[lostAtField] = '';
      updates[totalField] = (game[totalField] || 0) + Math.max(0, now.getTime() - lostAtMs);
    }

    const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, updates);
    return Response.json({ game: updatedGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});