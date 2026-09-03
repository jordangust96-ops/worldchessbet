import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// System sweep (invoked on a schedule by the Game Clock Timeout Sweep
// workflow — no user session involved, so this never checks auth.me()):
// resolves any in-progress Game whose authoritative server clock has
// actually run out, even when no connected client is present to trigger the
// existing per-game checkTimeout function (which only ever fires from a
// player's own browser, driven by its own local countdown). Without this, if
// both players disconnect or close their tab at or after a clock flag,
// nothing else ever resolves the Game — it (and both players' escrowed
// entry amounts and platform service fees) would otherwise stay stuck in
// 'active'/'in_progress' indefinitely, since settleMatch only ever acts on
// an already-completed Game.
//
// This mirrors checkPreparationTimeout's role for the earlier preparation
// phase, but note the distinction: it applies the exact same deterministic,
// already-decided rule checkTimeout applies (elapsed time vs. remaining
// clock, FIDE Article 6.9 insufficient-material handling) — this is NOT a
// discretionary abandonment/forfeiture policy call. GameSettings is explicit
// that grace-period expiration alone never forces a forfeit; this sweep
// changes nothing about that. It only reaches the same conclusion a
// connected client would already have reached on its own.

// Duplicated (not imported) in submitMove/checkTimeout — backend functions
// deploy independently and cannot share local modules. There is one
// authoritative implementation; keep all copies identical.
function parseServerTime(dateStr, fallbackMs) {
  if (!dateStr) return fallbackMs;
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(dateStr);
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
    const base44 = createClientFromRequest(req);

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
      if (remainingMs > 0) continue;

      // Re-fetch fresh state before doing any further work — never act on
      // the query snapshot above, which can be stale by the time a later
      // candidate in a large sweep is reached. Another path (a player's own
      // checkTimeout call, a resignation, a draw acceptance, or a legal
      // move) may have already resolved or advanced this game.
      const game = await base44.asServiceRole.entities.Game.get(candidate.id);
      if (!game || game.status !== 'active') continue;
      if (game.fen !== candidate.fen || game.turn_started_at !== candidate.turn_started_at) continue;

      const match = await base44.asServiceRole.entities.Match.get(game.match_id);
      if (!match) continue;

      // FIDE Article 6.9: the flagged player only loses if the opponent has
      // sufficient material to deliver checkmate by some legal sequence.
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

      // Final guard, taken fresh right before committing: the same race this
      // whole sweep exists to close for absent clients still applies between
      // the read above and this write (a client could reconnect and resolve
      // the game itself in that window).
      const preCommitGame = await base44.asServiceRole.entities.Game.get(game.id);
      if (!preCommitGame || preCommitGame.status === 'completed' || preCommitGame.fen !== game.fen) continue;

      await base44.asServiceRole.entities.Game.update(game.id, timeoutUpdates);
      resolvedIds.push(game.id);
    }

    return Response.json({ resolvedCount: resolvedIds.length, resolvedIds });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
