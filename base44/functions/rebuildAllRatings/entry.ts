import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { calculateSequentialGame, roundRatingNumber } from '../../shared/glicko2.js';
import { loadRatingConfig, ratingDefaults } from '../../shared/ratingPolicy.ts';
import {
  acquireRatingProcessingLock,
  renewRatingProcessingLock,
  releaseRatingProcessingLock,
} from '../../shared/ratingAtomicStore.ts';

const MAX_ROWS = 5000;
const EPSILON = 0.000001;

function keyFor(userId: string, timeControl: string) {
  return `${userId}:${timeControl}`;
}

function defaultState(defaults: any) {
  return {
    rating: defaults.rating,
    ratingDeviation: defaults.ratingDeviation,
    volatility: defaults.volatility,
    gamesRated: 0,
    lastMatchId: '',
    lastGameId: '',
    lastContestRecordId: '',
    lastRatedAt: '',
  };
}

function closeEnough(a: number, b: number) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPSILON;
}

async function ensureRebuildEvent(base44: any, {
  operation,
  generation,
  side,
  before,
  after,
  opponentBefore,
  score,
  defaults,
  reasonMatchId,
}: any) {
  const userId = side === 'player1' ? operation.player1_id : operation.player2_id;
  const opponentId = side === 'player1' ? operation.player2_id : operation.player1_id;
  const idempotencyKey = `rating-event:${userId}:${operation.game_id}:${generation}`;
  const existing = await base44.asServiceRole.entities.RatingEvent.filter({ idempotency_key: idempotencyKey });
  if (existing.length > 1) throw new Error(`duplicate_rebuild_event:${idempotencyKey}`);
  if (existing[0]) {
    const row = existing[0];
    if (
      !closeEnough(Number(row.rating_before), before.rating) ||
      !closeEnough(Number(row.rating_after), after.rating) ||
      !closeEnough(Number(row.rating_deviation_before), before.ratingDeviation) ||
      !closeEnough(Number(row.rating_deviation_after), after.ratingDeviation) ||
      Number(row.games_rated_before || 0) !== before.gamesRated ||
      Number(row.games_rated_after || 0) !== after.gamesRated
    ) {
      throw new Error(`rebuild_event_conflict:${idempotencyKey}`);
    }
    return row;
  }

  const eligibleAt = operation.rating_eligible_at || '';
  const settlementTimestamp = operation.settlement_timestamp || (
    eligibleAt ? new Date(new Date(eligibleAt).getTime() - 24 * 60 * 60 * 1000).toISOString() : new Date().toISOString()
  );

  return base44.asServiceRole.entities.RatingEvent.create({
    operation_id: operation.id,
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
    rating_before: before.rating,
    rating_after: after.rating,
    rating_delta: roundRatingNumber(after.rating - before.rating),
    rating_deviation_before: before.ratingDeviation,
    rating_deviation_after: after.ratingDeviation,
    volatility_before: before.volatility,
    volatility_after: after.volatility,
    opponent_rating_before: opponentBefore.rating,
    opponent_rating_deviation_before: opponentBefore.ratingDeviation,
    opponent_volatility_before: opponentBefore.volatility,
    games_rated_before: before.gamesRated,
    games_rated_after: after.gamesRated,
    provisional_before: before.gamesRated < defaults.provisionalGames,
    provisional_after: after.gamesRated < defaults.provisionalGames,
    algorithm_version: defaults.algorithmVersion,
    settlement_timestamp: settlementTimestamp,
    rating_eligible_at: eligibleAt,
    processed_at: new Date().toISOString(),
    source: 'rebuild',
    rebuild_reason_match_id: reasonMatchId || '',
  });
}

Deno.serve(async (req) => {
  const owner = crypto.randomUUID();
  let lockHeld = false;
  let config: any = null;
  let base44: any = null;
  try {
    base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    config = await loadRatingConfig(base44);
    if (!config) return Response.json({ error: 'rating_config_missing' }, { status: 503 });

    const requestedMatchId = String(body?.matchId || config.rebuild_reason_match_id || '');
    if (!requestedMatchId && config.rebuild_in_progress !== true) {
      return Response.json({ accepted: true, rebuild: false, reason: 'no_rebuild_requested' });
    }

    const targetGeneration = config.rebuild_in_progress === true && Number(config.rebuild_target_generation) > Number(config.current_generation || 0)
      ? Number(config.rebuild_target_generation)
      : Number(config.current_generation || 0) + 1;

    // Set the fail-closed guard before waiting for the global lock. A rating
    // sweep already in flight may finish its current work, but no new sweep
    // will start; the rebuild then deterministically includes every completed
    // operation except the invalidated contest(s).
    await base44.asServiceRole.entities.RatingSystemConfig.update(config.id, {
      rebuild_in_progress: true,
      rebuild_target_generation: targetGeneration,
      rebuild_reason_match_id: requestedMatchId || config.rebuild_reason_match_id || '',
      rebuild_last_error: '',
      last_rebuild_started_at: config.rebuild_in_progress === true
        ? (config.last_rebuild_started_at || new Date().toISOString())
        : new Date().toISOString(),
    });

    lockHeld = await acquireRatingProcessingLock(owner);
    if (!lockHeld) {
      return Response.json({ accepted: true, deferred: true, reason: 'rating_processor_busy', targetGeneration }, { status: 202 });
    }

    config = await loadRatingConfig(base44);
    const reasonMatchId = requestedMatchId || String(config?.rebuild_reason_match_id || '');

    if (reasonMatchId) {
      const targetOperations = await base44.asServiceRole.entities.RatingOperation.filter({ match_id: reasonMatchId });
      for (const operation of targetOperations) {
        if (operation.status === 'invalidated') continue;
        await base44.asServiceRole.entities.RatingOperation.update(operation.id, {
          status: 'invalidated',
          invalidated_at: new Date().toISOString(),
          invalidated_reason: 'contest_reversed_or_voided',
          last_error: '',
        });
      }

      if (!targetOperations.length && config.rebuild_in_progress === true) {
        // The contest never reached the rating ledger; there is nothing to
        // correct. Clear the guard without touching any current rating state.
        await base44.asServiceRole.entities.RatingSystemConfig.update(config.id, {
          rebuild_in_progress: false,
          rebuild_target_generation: Number(config.current_generation || 0),
          rebuild_reason_match_id: '',
          rebuild_last_error: '',
          last_rebuild_completed_at: new Date().toISOString(),
        });
        return Response.json({ accepted: true, rebuild: false, reason: 'contest_was_never_rated' });
      }
    }

    const allOperations = await base44.asServiceRole.entities.RatingOperation.list('rating_eligible_at', MAX_ROWS);
    const sourceOperations = allOperations
      .filter((operation: any) => operation.status === 'completed')
      .sort((a: any, b: any) =>
        String(a.rating_eligible_at || '').localeCompare(String(b.rating_eligible_at || '')) ||
        String(a.contest_record_id || '').localeCompare(String(b.contest_record_id || ''))
      );

    const existingRatings = await base44.asServiceRole.entities.PlayerRating.list(null, MAX_ROWS);
    const existingByKey = new Map<string, any>();
    const states = new Map<string, any>();
    for (const row of existingRatings) {
      const key = keyFor(row.user_id, row.time_control);
      if (existingByKey.has(key)) throw new Error(`duplicate_player_rating:${key}`);
      existingByKey.set(key, row);
      states.set(key, defaultState(ratingDefaults(config)));
    }

    const defaults = ratingDefaults({ ...config, current_generation: targetGeneration });
    const options = {
      initialRating: defaults.rating,
      initialRatingDeviation: defaults.ratingDeviation,
      initialVolatility: defaults.volatility,
      tau: defaults.tau,
    };

    let replayed = 0;
    for (const operation of sourceOperations) {
      if (!(await renewRatingProcessingLock(owner))) throw new Error('rating_processing_lock_lost');
      const p1Key = keyFor(operation.player1_id, operation.time_control);
      const p2Key = keyFor(operation.player2_id, operation.time_control);
      const p1Before = { ...(states.get(p1Key) || defaultState(defaults)) };
      const p2Before = { ...(states.get(p2Key) || defaultState(defaults)) };
      const p1AfterMath = calculateSequentialGame(p1Before, p2Before, Number(operation.player1_score), options);
      const p2AfterMath = calculateSequentialGame(p2Before, p1Before, Number(operation.player2_score), options);
      const settlementTimestamp = operation.settlement_timestamp || (
        operation.rating_eligible_at
          ? new Date(new Date(operation.rating_eligible_at).getTime() - 24 * 60 * 60 * 1000).toISOString()
          : ''
      );
      const p1After = {
        ...p1AfterMath,
        gamesRated: p1Before.gamesRated + 1,
        lastMatchId: operation.match_id,
        lastGameId: operation.game_id,
        lastContestRecordId: operation.contest_record_id,
        lastRatedAt: settlementTimestamp,
      };
      const p2After = {
        ...p2AfterMath,
        gamesRated: p2Before.gamesRated + 1,
        lastMatchId: operation.match_id,
        lastGameId: operation.game_id,
        lastContestRecordId: operation.contest_record_id,
        lastRatedAt: settlementTimestamp,
      };

      await Promise.all([
        ensureRebuildEvent(base44, {
          operation,
          generation: targetGeneration,
          side: 'player1',
          before: p1Before,
          after: p1After,
          opponentBefore: p2Before,
          score: Number(operation.player1_score),
          defaults,
          reasonMatchId,
        }),
        ensureRebuildEvent(base44, {
          operation,
          generation: targetGeneration,
          side: 'player2',
          before: p2Before,
          after: p2After,
          opponentBefore: p1Before,
          score: Number(operation.player2_score),
          defaults,
          reasonMatchId,
        }),
      ]);

      states.set(p1Key, p1After);
      states.set(p2Key, p2After);
      replayed += 1;
    }

    // Materialize the rebuilt generation only after every immutable event for
    // the target generation has been verified/created. If a crash occurs
    // earlier, current PlayerRating rows stay on the previous generation and
    // the next retry resumes against the same idempotent target events.
    const allKeys = new Set([...existingByKey.keys(), ...states.keys()]);
    for (const key of allKeys) {
      if (!(await renewRatingProcessingLock(owner))) throw new Error('rating_processing_lock_lost');
      const state = states.get(key) || defaultState(defaults);
      const existing = existingByKey.get(key);
      const [userId, timeControl] = key.split(':');
      const payload: any = {
        user_id: userId,
        time_control: timeControl,
        rating: state.rating,
        rating_deviation: state.ratingDeviation,
        volatility: state.volatility,
        games_rated: state.gamesRated,
        provisional: state.gamesRated < defaults.provisionalGames,
        generation: targetGeneration,
        algorithm_version: defaults.algorithmVersion,
        last_match_id: state.lastMatchId || '',
        last_game_id: state.lastGameId || '',
        last_contest_record_id: state.lastContestRecordId || '',
      };
      if (state.lastRatedAt) payload.last_rated_at = state.lastRatedAt;
      if (existing) await base44.asServiceRole.entities.PlayerRating.update(existing.id, payload);
      else if (state.gamesRated > 0) await base44.asServiceRole.entities.PlayerRating.create(payload);
    }

    await base44.asServiceRole.entities.RatingSystemConfig.update(config.id, {
      current_generation: targetGeneration,
      rebuild_in_progress: false,
      rebuild_target_generation: targetGeneration,
      rebuild_reason_match_id: '',
      rebuild_last_error: '',
      last_rebuild_completed_at: new Date().toISOString(),
    });

    return Response.json({
      accepted: true,
      rebuilt: true,
      generation: targetGeneration,
      sourceOperations: sourceOperations.length,
      replayed,
      reasonMatchId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'rating_rebuild_failed';
    console.error(JSON.stringify({ event: 'rating_rebuild_failed', error: message }));
    if (base44 && config?.id) {
      await base44.asServiceRole.entities.RatingSystemConfig.update(config.id, {
        rebuild_in_progress: true,
        rebuild_last_error: message.slice(0, 2000),
      }).catch(() => {});
    }
    return Response.json({ error: 'rating_rebuild_failed', diagnostic: message.slice(0, 300) }, { status: 500 });
  } finally {
    if (lockHeld) await releaseRatingProcessingLock(owner).catch(() => {});
  }
});
