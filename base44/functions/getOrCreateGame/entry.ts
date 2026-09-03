import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CLOCK_START_DELAY_MS = 4000;

// Starting clock time per ChessBet time control (mirrors the client-side map
// previously in useChessGame.js). No increments — clocks only count down.
const TIME_CONTROLS = {
  blitz: { initialMs: 3 * 60 * 1000 },
  rapid: { initialMs: 10 * 60 * 1000 },
  classical: { initialMs: 15 * 60 * 1000 },
};

// Single authoritative source of truth for creating the Game tied to a Match.
// Replaces the old client-side filter-then-create flow (which both players
// could race independently). Idempotent: however many times/clients call this
// for the same matchId, only one Game is ever authoritative — every caller
// converges on the same Game id.
//
// Only ever creates or attaches a Game for a match in a status where that is
// legitimate (both_ready and later). This is deliberate defense in depth
// against a match that has been cancelled (refunded) — whether by the user
// or by the preparation-timeout sweep — ever ending up with a live Game
// attached, which would otherwise let both players play a real-money match
// for free after already being refunded.
const LIVE_OR_POST_START_STATUSES = new Set(['both_ready', 'in_progress', 'settling', 'completed']);
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { matchId } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
    if (Number(match.launch_epoch) !== 2) return Response.json({ error: 'Match not available' }, { status: 410 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    if (!LIVE_OR_POST_START_STATUSES.has(match.status)) {
      return Response.json({ error: 'This match is not in a state that can have a game attached' }, { status: 409 });
    }

    // Already attached — just return it.
    if (match.game_id) {
      let existingGame = await base44.asServiceRole.entities.Game.get(match.game_id);
      if (existingGame) {
        if (existingGame.player1_id !== match.player1_id || existingGame.player2_id !== match.player2_id) {
          existingGame = await base44.asServiceRole.entities.Game.update(existingGame.id, {
            player1_id: match.player1_id,
            player2_id: match.player2_id,
          });
        }
        return Response.json({ game: existingGame });
      }
    }

    // No game_id on the match yet. Check whether one was already created (by a
    // near-simultaneous call from the other player) but not yet attached.
    let candidates = await base44.asServiceRole.entities.Game.filter({ match_id: matchId }, 'created_date', 10);

    if (candidates.length === 0) {
      const tc = TIME_CONTROLS[match.time_control] || TIME_CONTROLS.rapid;
      await base44.asServiceRole.entities.Game.create({
        launch_epoch: 2,
        match_id: matchId,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        status: 'active',
        fen: START_FEN,
        pgn: '',
        result: 'unfinished',
        white_time_ms: tc.initialMs,
        black_time_ms: tc.initialMs,
        increment_ms: 0,
        // The shared UI ceremony lasts three seconds. A small server-side
        // buffer ensures neither player loses time before the board is usable.
        turn_started_at: new Date(Date.now() + CLOCK_START_DELAY_MS).toISOString(),
      });
      // Re-fetch rather than trust our own create result, so that if another
      // concurrent call also created one, every caller deterministically
      // converges on the same (oldest) canonical record below.
      candidates = await base44.asServiceRole.entities.Game.filter({ match_id: matchId }, 'created_date', 10);
    }

    // Oldest record is the canonical Game — deterministic across every
    // concurrent caller, so all clients end up attaching/loading the same one
    // even if more than one Game row was momentarily created.
    let canonicalGame = candidates[0];

    if (canonicalGame.player1_id !== match.player1_id || canonicalGame.player2_id !== match.player2_id) {
      canonicalGame = await base44.asServiceRole.entities.Game.update(canonicalGame.id, {
        player1_id: match.player1_id,
        player2_id: match.player2_id,
      });
    }

    // Repair any pre-hardening or partially-created active game that lacks a
    // clock anchor. Once set, this timestamp is never reset by later loads.
    if (!canonicalGame.turn_started_at) {
      canonicalGame = await base44.asServiceRole.entities.Game.update(canonicalGame.id, {
        turn_started_at: new Date(Date.now() + CLOCK_START_DELAY_MS).toISOString(),
      });
    }

    const freshMatch = await base44.asServiceRole.entities.Match.get(matchId);
    // Re-check status against the freshest read before attaching — a
    // cancellation could have landed while the above ran. If so, leave the
    // Game unattached: it stays unreachable through the match (every lookup
    // here is keyed off matchId + this status gate), and simply becomes an
    // orphaned row rather than a live game on a refunded match.
    if (!freshMatch.game_id && LIVE_OR_POST_START_STATUSES.has(freshMatch.status)) {
      await base44.asServiceRole.entities.Match.update(matchId, { game_id: canonicalGame.id });
    }

    return Response.json({ game: canonicalGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});