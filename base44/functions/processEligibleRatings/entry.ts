import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { calculateSequentialGame, roundRatingNumber } from '../../shared/glicko2.js';
import { REPORT_WINDOW_MS } from '../../shared/reportWindow.ts';
import {
  evaluateContestRatingEligibility,
  loadRatingConfig,
  ratingDefaults,
} from '../../shared/ratingPolicy.ts';
import {
  acquireRatingProcessingLock,
  renewRatingProcessingLock,
  releaseRatingProcessingLock,
} from '../../shared/ratingAtomicStore.ts';

const PAGE_SIZE = 500;
const MAX_APPLY_PER_RUN = 25;
const STATE_EPSILON = 0.000001;

class RatingStateConflict extends Error {}

function stateFromRow(row: any, defaults: any) {
  if (!row) {
    return {
      rating: defaults.rating,
      ratingDeviation: defaults.ratingDeviation,
      volatility: defaults.volatility,
      gamesRated: 0,
      provisional: true,
      generation: defaults.generation,
    };
  }
  return {
    rating: Number(row.rating),
    ratingDeviation: Number(row.rating_deviation),
    volatility: Number(row.volatility),
    gamesRated: Number(row.games_rated) || 0,
    provisional: row.provisional !== false,
    generation: Number(row.generation) || 0,
  };
}

function closeEnough(a: number, b: number) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= STATE_EPSILON;
}

function rowMatchesSnapshot(row: any, snapshot: any, generation: number) {
  if (!row) return false;
  return (
    closeEnough(Number(row.rating), snapshot.rating) &&
    closeEnough(Number(row.rating_deviation), snapshot.ratingDeviation) &&
    closeEnough(Number(row.volatility), snapshot.volatility) &&
    Number(row.games_rated || 0) === snapshot.gamesRated &&
    Number(row.generation || 0) === generation
  );
}

async function getSinglePlayerRating(base44: any, userId: string, timeControl: string) {
  const rows = await base44.asServiceRole.entities.PlayerRating.filter({ user_id: userId, time_control: timeControl });
  if (rows.length > 1) throw new RatingStateConflict(`duplicate_player_rating:${userId}:${timeControl}`);
  return rows[0] || null;
}

function operationSnapshot(operation: any, side: 'player1' | 'player2', phase: 'before' | 'after') {
  const prefix = side === 'player1' ? 'player1' : 'player2';
  const before = phase === 'before';
  return {
    rating: Number(operation[`${prefix}_rating_${phase}`]),
    ratingDeviation: Number(operation[`${prefix}_rd_${phase}`]),
    volatility: Number(operation[`${prefix}_volatility_${phase}`]),
    gamesRated: Number(operation[`${prefix}_games_before`] || 0) + (before ? 0 : 1),
  };
}

async function reconcilePlayerState(base44: any, {
  operation,
  side,
  userId,
  defaults,
  contestRecord,
}: any) {
  const before = operationSnapshot(operation, side, 'before');
  const after = operationSnapshot(operation, side, 'after');
  const generation = Number(operation.generation) || 0;
  const existing = await getSinglePlayerRating(base44, userId, operation.time_control);

  if (existing && rowMatchesSnapshot(existing, after, generation)) return existing;

  if (!existing) {
    const defaultBefore = {
      rating: defaults.rating,
      ratingDeviation: defaults.ratingDeviation,
      volatility: defaults.volatility,
      gamesRated: 0,
    };
    if (
      before.gamesRated !== 0 ||
      !closeEnough(before.rating, defaultBefore.rating) ||
      !closeEnough(before.ratingDeviation, defaultBefore.ratingDeviation) ||
      !closeEnough(before.volatility, defaultBefore.volatility)
    ) {
      throw new RatingStateConflict(`missing_expected_rating_row:${userId}:${operation.time_control}`);
    }
    return base44.asServiceRole.entities.PlayerRating.create({
      user_id: userId,
      time_control: operation.time_control,
      rating: after.rating,
      rating_deviation: after.ratingDeviation,
      volatility: after.volatility,
      games_rated: after.gamesRated,
      provisional: after.gamesRated < defaults.provisionalGames,
      generation,
      algorithm_version: operation.algorithm_version,
      last_match_id: operation.match_id,
      last_game_id: operation.game_id,
      last_contest_record_id: operation.contest_record_id,
      last_rated_at: contestRecord.settlement_timestamp,
    });
  }

  if (!rowMatchesSnapshot(existing, before, generation)) {
    throw new RatingStateConflict(`rating_state_conflict:${userId}:${operation.time_control}`);
  }

  return base44.asServiceRole.entities.PlayerRating.update(existing.id, {
    rating: after.rating,
    rating_deviation: after.ratingDeviation,
    volatility: after.volatility,
    games_rated: after.gamesRated,
    provisional: after.gamesRated < defaults.provisionalGames,
    generation,
    algorithm_version: operation.algorithm_version,
    last_match_id: operation.match_id,
    last_game_id: operation.game_id,
    last_contest_record_id: operation.contest_record_id,
    last_rated_at: contestRecord.settlement_timestamp,
  });
}

async function ensureRatingEvent(base44: any, {
  operation,
  operationId,
  contestRecord,
  side,
  userId,
  opponentId,
  score,
  defaults,
  source = 'normal',
  rebuildReasonMatchId = '',
}: any) {
  const generation = Number(operation.generation) || 0;
  const idempotencyKey = `rating-event:${userId}:${operation.game_id}:${generation}`;
  const existing = await base44.asServiceRole.entities.RatingEvent.filter({ idempotency_key: idempotencyKey });
  if (existing.length > 1) throw new RatingStateConflict(`duplicate_rating_event:${idempotencyKey}`);
  if (existing[0]) return existing[0];

  const ownBefore = operationSnapshot(operation, side, 'before');
  const ownAfter = operationSnapshot(operation, side, 'after');
  const opponentSide = side === 'player1' ? 'player2' : 'player1';
  const opponentBefore = operationSnapshot(operation, opponentSide, 'before');
  const gamesBefore = ownBefore.gamesRated;
  const gamesAfter = ownAfter.gamesRated;

  return base44.asServiceRole.entities.RatingEvent.create({
    operation_id: operationId,
    idempotency_key: idempotencyKey,
    event_type: 'game',
    generation,
    user_id: userId,
    opponent_user_id: opponentId,
    match_id: operation.match_id,
    game_id: operation.game_id,
    contest_record_id: operation.contest_record_id,
    time_control: operation.time_control,
    color: side === 'player1' ? 'white' : 'black',
    score,
    rating_before: ownBefore.rating,
    rating_after: ownAfter.rating,
    rating_delta: roundRatingNumber(ownAfter.rating - ownBefore.rating),
    rating_deviation_before: ownBefore.ratingDeviation,
    rating_deviation_after: ownAfter.ratingDeviation,
    volatility_before: ownBefore.volatility,
    volatility_after: ownAfter.volatility,
    opponent_rating_before: opponentBefore.rating,
    opponent_rating_deviation_before: opponentBefore.ratingDeviation,
    opponent_volatility_before: opponentBefore.volatility,
    games_rated_before: gamesBefore,
    games_rated_after: gamesAfter,
    provisional_before: gamesBefore < defaults.provisionalGames,
    provisional_after: gamesAfter < defaults.provisionalGames,
    algorithm_version: operation.algorithm_version,
    settlement_timestamp: contestRecord.settlement_timestamp,
    rating_eligible_at: operation.rating_eligible_at,
    processed_at: new Date().toISOString(),
    source,
    rebuild_reason_match_id: rebuildReasonMatchId,
  });
}

async function applyPreparedOperation(base44: any, operation: any, contestRecord: any, defaults: any) {
  if (operation.status === 'completed' || operation.status === 'invalidated') return operation;
  // `recovery_required` is intentionally retryable. The persisted before/after
  // snapshots let reconcilePlayerState prove whether each side is still at the
  // before state or has already advanced to the after state, so an unambiguous
  // half-applied operation can self-heal on the next sweep.
  if (Number(operation.generation || 0) !== defaults.generation) {
    throw new RatingStateConflict(`operation_generation_mismatch:${operation.id}`);
  }

  await base44.asServiceRole.entities.RatingOperation.update(operation.id, {
    status: 'applying',
    attempt_count: Number(operation.attempt_count || 0) + 1,
    last_error: '',
  });

  try {
    await reconcilePlayerState(base44, {
      operation,
      side: 'player1',
      userId: operation.player1_id,
      defaults,
      contestRecord,
    });
    await reconcilePlayerState(base44, {
      operation,
      side: 'player2',
      userId: operation.player2_id,
      defaults,
      contestRecord,
    });

    const [p1Event, p2Event] = await Promise.all([
      ensureRatingEvent(base44, {
        operation,
        operationId: operation.id,
        contestRecord,
        side: 'player1',
        userId: operation.player1_id,
        opponentId: operation.player2_id,
        score: Number(operation.player1_score),
        defaults,
      }),
      ensureRatingEvent(base44, {
        operation,
        operationId: operation.id,
        contestRecord,
        side: 'player2',
        userId: operation.player2_id,
        opponentId: operation.player1_id,
        score: Number(operation.player2_score),
        defaults,
      }),
    ]);

    return await base44.asServiceRole.entities.RatingOperation.update(operation.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      player1_event_id: p1Event.id,
      player2_event_id: p2Event.id,
      last_error: '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'rating_operation_failed';
    const conflict = error instanceof RatingStateConflict;
    await base44.asServiceRole.entities.RatingOperation.update(operation.id, {
      status: conflict ? 'recovery_required' : 'prepared',
      last_error: message.slice(0, 2000),
    }).catch(() => {});
    throw error;
  }
}

async function prepareOperation(base44: any, contestRecord: any, eligibility: any, defaults: any) {
  const operationKey = `rating-operation:${contestRecord.id}`;
  const existing = await base44.asServiceRole.entities.RatingOperation.filter({ operation_key: operationKey });
  if (existing.length > 1) throw new RatingStateConflict(`duplicate_rating_operation:${operationKey}`);
  const existingOperation = existing[0] || null;

  // Completed operations remain the one durable contest-processing record.
  // A contest-reversal invalidation is permanent. `superseded_by_rebuild`,
  // however, means an old-generation operation was in-flight when a rebuild
  // reset materialized state; it is safe and necessary to re-prepare that same
  // row from the new canonical generation rather than strand both players.
  if (existingOperation?.status === 'completed') return existingOperation;
  if (existingOperation?.status === 'invalidated' && existingOperation.invalidated_reason !== 'superseded_by_rebuild') {
    return existingOperation;
  }
  const needsFreshSnapshot = !!existingOperation && (
    existingOperation.status === 'invalidated' ||
    Number(existingOperation.generation || 0) !== defaults.generation
  );
  if (existingOperation && !needsFreshSnapshot) return existingOperation;

  const [p1Row, p2Row] = await Promise.all([
    getSinglePlayerRating(base44, contestRecord.white_player_id, contestRecord.time_control),
    getSinglePlayerRating(base44, contestRecord.black_player_id, contestRecord.time_control),
  ]);
  const p1 = stateFromRow(p1Row, defaults);
  const p2 = stateFromRow(p2Row, defaults);
  if (p1.generation !== defaults.generation || p2.generation !== defaults.generation) {
    throw new RatingStateConflict('player_rating_generation_mismatch');
  }

  const player1Score = eligibility.isDraw ? 0.5 : (contestRecord.winner_id === contestRecord.white_player_id ? 1 : 0);
  const player2Score = eligibility.isDraw ? 0.5 : (contestRecord.winner_id === contestRecord.black_player_id ? 1 : 0);
  const options = {
    initialRating: defaults.rating,
    initialRatingDeviation: defaults.ratingDeviation,
    initialVolatility: defaults.volatility,
    tau: defaults.tau,
  };
  const p1After = calculateSequentialGame(p1, p2, player1Score, options);
  const p2After = calculateSequentialGame(p2, p1, player2Score, options);
  const payload = {
    operation_key: operationKey,
    status: 'prepared',
    generation: defaults.generation,
    match_id: contestRecord.match_id,
    game_id: contestRecord.game_id,
    contest_record_id: contestRecord.id,
    time_control: contestRecord.time_control,
    player1_id: contestRecord.white_player_id,
    player2_id: contestRecord.black_player_id,
    player1_score: player1Score,
    player2_score: player2Score,
    player1_rating_before: p1.rating,
    player1_rd_before: p1.ratingDeviation,
    player1_volatility_before: p1.volatility,
    player1_games_before: p1.gamesRated,
    player1_rating_after: p1After.rating,
    player1_rd_after: p1After.ratingDeviation,
    player1_volatility_after: p1After.volatility,
    player2_rating_before: p2.rating,
    player2_rd_before: p2.ratingDeviation,
    player2_volatility_before: p2.volatility,
    player2_games_before: p2.gamesRated,
    player2_rating_after: p2After.rating,
    player2_rd_after: p2After.ratingDeviation,
    player2_volatility_after: p2After.volatility,
    algorithm_version: defaults.algorithmVersion,
    settlement_timestamp: contestRecord.settlement_timestamp,
    rating_eligible_at: eligibility.eligibleAt,
    prepared_at: new Date().toISOString(),
    completed_at: '',
    invalidated_at: '',
    invalidated_reason: '',
    player1_event_id: '',
    player2_event_id: '',
    last_error: '',
    attempt_count: 0,
  };

  return existingOperation
    ? base44.asServiceRole.entities.RatingOperation.update(existingOperation.id, payload)
    : base44.asServiceRole.entities.RatingOperation.create(payload);
}

Deno.serve(async (req) => {
  const owner = crypto.randomUUID();
  let lockHeld = false;
  try {
    const base44 = createClientFromRequest(req);
    const config = await loadRatingConfig(base44);
    if (!config) return Response.json({ accepted: false, reason: 'rating_config_missing' }, { status: 503 });
    if (config.processing_enabled !== true) return Response.json({ accepted: true, disabled: true });
    if (config.public_enabled === true) {
      // Shadow backend may continue to calculate if public_enabled is later
      // enabled, but this function itself never exposes player data.
    }
    if (config.rebuild_in_progress === true) {
      const rebuild = await base44.asServiceRole.functions.invoke('rebuildAllRatings', {
        resume: true,
      }).catch((error: any) => ({ error: error?.message || 'rating_rebuild_resume_failed' }));
      return Response.json({ accepted: true, deferred: true, reason: 'rating_rebuild_in_progress', rebuild });
    }

    const defaults = ratingDefaults(config);
    lockHeld = await acquireRatingProcessingLock(owner);
    if (!lockHeld) return Response.json({ accepted: true, deferred: true, reason: 'rating_processor_busy' });

    let scanned = 0;
    let applied = 0;
    let deferred = 0;
    let permanentSkips = 0;
    const errors: string[] = [];
    const blockedPlayers = new Set<string>();
    let stop = false;

    // Page through the entire durable ContestRecord backlog. There is no hard
    // scan ceiling: old already-rated rows may make discovery O(N), but they
    // can never cause newer contests to become permanently unreachable.
    for (let skip = 0; !stop && applied < MAX_APPLY_PER_RUN; skip += PAGE_SIZE) {
      const page = await base44.asServiceRole.entities.ContestRecord.list('settlement_timestamp', PAGE_SIZE, skip);
      if (!page.length) break;

      for (const contestRecord of page) {
        if (applied >= MAX_APPLY_PER_RUN) break;
        scanned += 1;
        const settlementMs = new Date(contestRecord.settlement_timestamp || 0).getTime();
        const historyStartMs = new Date(config.history_start_at || 0).getTime();
        if (!Number.isFinite(settlementMs) || settlementMs < historyStartMs) continue;

        // Ascending settlement order is a hard invariant for sequential
        // ratings. Once we reach a record whose 24h window cannot have closed,
        // no later record can be eligible in this run either.
        if (Date.now() < settlementMs + REPORT_WINDOW_MS) {
          stop = true;
          break;
        }

        const existingOps = await base44.asServiceRole.entities.RatingOperation.filter({
          operation_key: `rating-operation:${contestRecord.id}`,
        });
        if (existingOps.length > 1) {
          errors.push(`duplicate_operation:${contestRecord.id}`);
          blockedPlayers.add(contestRecord.white_player_id);
          blockedPlayers.add(contestRecord.black_player_id);
          continue;
        }
        const existingOperation = existingOps[0] || null;
        if (existingOperation?.status === 'completed') continue;
        if (existingOperation?.status === 'invalidated' && existingOperation.invalidated_reason !== 'superseded_by_rebuild') continue;

        // If an earlier unresolved contest prevents either player's canonical
        // state from being known, this contest must wait too. Propagate the
        // block to the opponent, but keep processing unrelated player chains.
        if (blockedPlayers.has(contestRecord.white_player_id) || blockedPlayers.has(contestRecord.black_player_id)) {
          deferred += 1;
          blockedPlayers.add(contestRecord.white_player_id);
          blockedPlayers.add(contestRecord.black_player_id);
          continue;
        }

        const eligibility = await evaluateContestRatingEligibility(base44, contestRecord, config);
        if (!eligibility.eligible) {
          if (eligibility.permanent) permanentSkips += 1;
          else {
            deferred += 1;
            blockedPlayers.add(contestRecord.white_player_id);
            blockedPlayers.add(contestRecord.black_player_id);
          }
          continue;
        }

        if (!(await renewRatingProcessingLock(owner))) {
          throw new Error('rating_processing_lock_lost');
        }

        try {
          // Always pass through prepareOperation. It is idempotent for a
          // current prepared/applying/recovery row, and refreshes any stale
          // old-generation operation that a rebuild marked as superseded.
          const operation = await prepareOperation(base44, contestRecord, eligibility, defaults);
          await applyPreparedOperation(base44, operation, contestRecord, defaults);
          applied += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'rating_processing_failed';
          errors.push(`${contestRecord.id}:${message}`.slice(0, 500));
          // Never leapfrog a failed earlier contest for either participant.
          // Unrelated player chains may continue safely in the same sweep.
          blockedPlayers.add(contestRecord.white_player_id);
          blockedPlayers.add(contestRecord.black_player_id);
          continue;
        }
      }

      if (page.length < PAGE_SIZE) break;
    }

    return Response.json({
      accepted: true,
      shadow: true,
      generation: defaults.generation,
      scanned,
      applied,
      deferred,
      permanentSkips,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'rating_sweep_failed';
    console.error(JSON.stringify({ event: 'rating_sweep_failed', error: message }));
    return Response.json({ error: 'rating_sweep_failed', diagnostic: message.slice(0, 300) }, { status: 500 });
  } finally {
    if (lockHeld) await releaseRatingProcessingLock(owner).catch(() => {});
  }
});
