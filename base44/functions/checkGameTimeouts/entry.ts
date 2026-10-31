import { guardGameMutations } from '../../shared/gameMutationGuard.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { checkDisconnectTimeout } from '../../shared/disconnectPolicy.js';

// System sweep for active games. It preserves the chess clock as the
// independent authority when a clock reaches zero, and also completes a
// disconnected side-to-move only after the time-control-specific reconnect
// window plus a fresh-heartbeat confirmation interval. A missed heartbeat is
// never treated as proof of intentional abandonment.
function parseServerTime(dateStr, fallbackMs) {
  if (!dateStr) return fallbackMs;
  const hasTz = /Z$|[+-]\\d{2}:?\\d{2}$/.test(dateStr);
  const parsedMs = new Date(hasTz ? dateStr : `${dateStr}Z`).getTime();
  return Number.isFinite(parsedMs) ? parsedMs : fallbackMs;
}

function hasSufficientMatingMaterial(fen, color) {
  const boardPart = fen.split(' ')[0];
  let pawns = 0, knights = 0, bishops = 0, rooks = 0, queens = 0;
  for (const ch of boardPart) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const pieceColor = ch === ch.toUpperCase() ? 'w' : 'b';
    if (pieceColor !== color) continue;
    switch (ch.toLowerCase()) {
      case 'p': pawns++; break;
      case 'n': knights++; break;
      case 'b': bishops++; break;
      case 'r': rooks++; break;
      case 'q': queens++; break;
    }
  }
  if (pawns > 0 || rooks > 0 || queens > 0) return true;
  return knights + bishops >= 2;
}

Deno.serve(async (req) => {
  try {
    const base44 = guardGameMutations(createClientFromRequest(req));

    const activeGames = await base44.asServiceRole.entities.Game.filter(
      { launch_epoch: 2, status: 'active' },
      '-created_date',
      200
    );

    const now = Date.now();
    const resolvedIds = [];

    for (const candidate of activeGames) {
      const sideToMove = candidate.fen?.split(' ')[1] === 'b' ? 'b' : 'w';
      const turnStartedAt = parseServerTime(candidate.turn_started_at, now);
      const elapsedMs = Math.max(0, now - turnStartedAt);
      const timeField = sideToMove === 'w' ? 'white_time_ms' : 'black_time_ms';
      const remainingMs = (candidate[timeField] ?? 0) - elapsedMs;

      if (remainingMs > 0) {
        const match = await base44.asServiceRole.entities.Match.get(candidate.match_id);
        if (match) {
          const disconnectCheck = await checkDisconnectTimeout(base44, candidate, match, now).catch(() => ({completed:false}));
          if (disconnectCheck.completed) resolvedIds.push(candidate.id);
        }
        continue;
      }

      // Re-fetch fresh state before resolving a flag. Another path (a player's
      // checkTimeout call, a resignation, a draw acceptance, or a legal move)
      // may have completed or advanced the game since the sweep snapshot.
      const game = await base44.asServiceRole.entities.Game.get(candidate.id);
      if (!game || game.status !== 'active') continue;
      if (game.fen !== candidate.fen || game.turn_started_at !== candidate.turn_started_at) continue;

      const match = await base44.asServiceRole.entities.Match.get(game.match_id);
      if (!match) continue;

      // FIDE Article 6.9: a clock flag is a draw if the opponent cannot
      // deliver checkmate by any legal sequence.
      const opponentColor = sideToMove === 'w' ? 'b' : 'w';
      const opponentCanMate = hasSufficientMatingMaterial(game.fen, opponentColor);

      const timeoutUpdates = opponentCanMate
        ? {
            status: 'completed',
            result: sideToMove === 'w' ? 'black_win' : 'white_win',
            winner_id: sideToMove === 'w' ? match.player2_id : match.player1_id,
            end_reason: 'timeout',
            completed_at: new Date().toISOString(),
            draw_offered_by: '',
            [timeField]: 0,
          }
        : {
            status: 'completed',
            result: 'draw',
            winner_id: '',
            end_reason: 'timeout_vs_insufficient_material',
            completed_at: new Date().toISOString(),
            draw_offered_by: '',
            [timeField]: 0,
          };

      // Final fresh-state guard before committing the result.
      const preCommitGame = await base44.asServiceRole.entities.Game.get(game.id);
      if (
        !preCommitGame ||
        preCommitGame.status === 'completed' ||
        preCommitGame.fen !== game.fen ||
        preCommitGame.turn_started_at !== game.turn_started_at
      ) continue;

      try { await base44.asServiceRole.entities.Game.update(game.id, timeoutUpdates); }
      catch (error) { if (error.status === 409) continue; throw error; }
      resolvedIds.push(game.id);
    }

    return Response.json({ resolvedCount: resolvedIds.length, resolvedIds });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
