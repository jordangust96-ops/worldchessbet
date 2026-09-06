import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { calculateSequentialGame, roundRatingNumber } from '../../shared/glicko2.js';
import { REPORT_WINDOW_MS } from '../../shared/reportWindow.ts';
import { loadRatingConfig, ratingDefaults } from '../../shared/ratingPolicy.ts';
import {
  acquireRatingProcessingLock,
  renewRatingProcessingLock,
  releaseRatingProcessingLock,
} from '../../shared/ratingAtomicStore.ts';

const PAGE_SIZE = 500;
const EPSILON = 0.000001;

class RebuildGenerationConflict extends Error {}

function keyFor(userId: string, timeControl: string) {
  return JSON.stringify([userId, timeControl]);
}

function parseKey(key: string) {
  const parsed = JSON.parse(key);
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('invalid_rating_state_key');
  return [String(parsed[0]), String(parsed[1])];
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

async function listAll(entity: any, sort: string | null = 'created_date') {
  const rows: any[] = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await entity.list(sort, PAGE_SIZE, skip);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadInvalidatedMatchIds(base44: any) {
  const cases = await listAll(base44.asServiceRole.entities.DisputeCase, 'created_date');
  return new Set(
    cases
      .filter((row: any) => row.status === 'resolved' && ['contest_reversed', 'contest_voided'].includes(row.resolution_type))
      .map((row: any) => String(row.match_id || ''))
      .filter(Boolean)
  );
}

async function rotateTargetGeneration(base44: any, config: any, message: string) {
  const latest = await loadRatingConfig(base44);
  if (!latest) return null;
  const nextTarget = Math.max(
    Number(latest.current_generation || 0) + 1,
    Number(latest.rebuild_target_generation || config?.rebuild_target_generation || 0) + 1
  );
  return base44.asServiceRole.entities.RatingSystemConfig.update(latest.id, {
    rebuild_in_progress: true,
    rebuild_target_generation: nextTarget,
    rebuild_last_error: message.slice(0, 2000),
  });
}

async function newerRebuildRequestArrived(base44: any, capturedRequestCounter: number) {
  const latest = await loadRatingConfig(base44);
  return {
    latest,
    changed: !!latest && Number(latest.rebuild_request_counter || 0) !== capturedRequestCounter,
  };
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
      !closeEnough(Number(row.volatility_before), before.volatility) ||
      !closeEnough(Number(row.volatility_after), after.volatility) ||
      Number(row.games_rated_before || 0) !== before.gamesRated ||
      Number(row.games_rated_after || 0) !== after.gamesRated
    ) {
      // RatingEvent is intentionally immutable. Never fight a stale partial
      // generation: abandon that generation and replay into a fresh one.
      throw new RebuildGenerationConflict(`rebuild_event_conflict:${idempotencyKey}`);
    }
    return row;
  }

  const eligibleAt = operation.rating_eligible_at || '';
  const settlementTimestamp = operation.settlement_timestamp || (
    eligibleAt ? new Date(new Date(eligibleAt).getTime() - REPORT_WINDOW_MS).toISOString() : new Date().toISOString()
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
  let capturedRequestCounter = 0;
  let targetGeneration = 0;

  try {
    base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const explicitRequestMatchId = body?.resume === true ? '' : String(body?.matchId || '');
    config = await loadRatingConfig(base44);
    if (!config) return Response.json({ error: 'rating_config_missing' }, { status: 503 });

    const wasInProgress = config.rebuild_in_progress === true;
    if (!explicitRequestMatchId && !wasInProgress) {
      return Response.json({ accepted: true, rebuild: false, reason: 'no_rebuild_requested' });
    }

    targetGeneration = wasInProgress && Number(config.rebuild_target_generation) > Number(config.current_generation || 0)
      ? Number(config.rebuild_target_generation)
      : Number(config.current_generation || 0) + 1;

    const nextRequestCounter = Number(config.rebuild_request_counter || 0) + (explicitRequestMatchId ? 1 : 0);
    await base44.asServiceRole.entities.RatingSystemConfig.update(config.id, {
      rebuild_in_progress: true,
      rebuild_target_generation: targetGeneration,
      rebuild_request_counter: nextRequestCounter,
      rebuild_reason_match_id: explicitRequestMatchId || config.rebuild_reason_match_id || '',
      rebuild_last_error: '',
      last_rebuild_started_at: wasInProgress
        ? (config.last_rebuild_started_at || new Date().toISOString())
        : new Date().toISOString(),
    });

    lockHeld = await acquireRatingProcessingLock(owner);
    if (!lockHeld) {
      return Response.json({ accepted: true, deferred: true, reason: 'rating_processor_busy', targetGeneration }, { status: 202 });
    }

    config = await loadRatingConfig(base44);
    if (!config) throw new Error('rating_config_missing_after_lock');
    targetGeneration = Number(config.rebuild_target_generation || targetGeneration);
    capturedRequestCounter = Number(config.rebuild_request_counter || 0);
    const reasonMatchId = explicitRequestMatchId || String(config.rebuild_reason_match_id || '');

    // No fixed row ceiling: rebuilds must either consume the complete durable
    // source or fail closed. Silent partial replay is never acceptable.
    const allOperations = await listAll(base44.asServiceRole.entities.RatingOperation, 'rating_eligible_at');
    const invalidatedMatchIds = await loadInvalidatedMatchIds(base44);

    const requestedOperations = reasonMatchId
      ? allOperations.filter((operation: any) => operation.match_id === reasonMatchId)
      : [];
    if (explicitRequestMatchId && !wasInProgress && requestedOperations.length === 0) {
      await base44.asServiceRole.entities.RatingSystemConfig.update(config.id, {
        rebuild_in_progress: false,
        rebuild_target_generation: Number(config.current_generation || 0),
        rebuild_reason_match_id: '',
        rebuild_last_error: '',
        last_rebuild_completed_at: new Date().toISOString(),
      });
      return Response.json({ accepted: true, rebuild: false, reason: 'contest_was_never_rated' });
    }

    // Invalidate every resolved reversed/voided contest, not only the match
    // that happened to trigger this invocation. This makes concurrent dispute
    // resolutions converge on the same canonical source set.
    for (const operation of allOperations) {
      if (invalidatedMatchIds.has(String(operation.match_id || ''))) {
        if (operation.status !== 'invalidated' || operation.invalidated_reason !== 'contest_reversed_or_voided') {
          await base44.asServiceRole.entities.RatingOperation.update(operation.id, {
            status: 'invalidated',
            invalidated_at: new Date().toISOString(),
            invalidated_reason: 'contest_reversed_or_voided',
            last_error: '',
          });
        }
        continue;
      }

      // Any old-generation operation that never reached completed is not part
      // of canonical history. Rebuild materialization below resets its players
      // to the state derived only from completed operations. Mark it superseded
      // so the normal sweep can safely re-prepare the same contest afterward.
      if (['prepared', 'applying', 'recovery_required'].includes(operation.status)) {
        await base44.asServiceRole.entities.RatingOperation.update(operation.id, {
          status: 'invalidated',
          invalidated_at: new Date().toISOString(),
          invalidated_reason: 'superseded_by_rebuild',
          last_error: '',
        });
      }
    }

    const sourceOperations = allOperations
      .filter((operation: any) => operation.status === 'completed' && !invalidatedMatchIds.has(String(operation.match_id || '')))
      .sort((a: any, b: any) =>
        String(a.rating_eligible_at || '').localeCompare(String(b.rating_eligible_at || '')) ||
        String(a.contest_record_id || '').localeCompare(String(b.contest_record_id || ''))
      );

    const preReplayRequestCheck = await newerRebuildRequestArrived(base44, capturedRequestCounter);
    if (preReplayRequestCheck.changed) {
      const rotated = await rotateTargetGeneration(base44, config, 'rebuild_restarted_for_new_request_before_replay');
      return Response.json({ accepted: true, deferred: true, reason: 'newer_rebuild_request', targetGeneration: rotated?.rebuild_target_generation }, { status: 202 });
    }

    const existingRatings = await listAll(base44.asServiceRole.entities.PlayerRating, 'created_date');
    const existingByKey = new Map<string, any>();
    const states = new Map<string, any>();
    const defaults = ratingDefaults({ ...config, current_generation: targetGeneration });

    for (const row of existingRatings) {
      const key = keyFor(row.user_id, row.time_control);
      if (existingByKey.has(key)) throw new Error(`duplicate_player_rating:${key}`);
      existingByKey.set(key, row);
      states.set(key, defaultState(defaults));
    }

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
          ? new Date(new Date(operation.rating_eligible_at).getTime() - REPORT_WINDOW_MS).toISOString()
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

    // A newer reversal/void may have landed while replay was creating immutable
    // events. Do not materialize that stale source set. Rotate to a fresh
    // generation; old partial events remain non-canonical audit records.
    const preMaterializeRequestCheck = await newerRebuildRequestArrived(base44, capturedRequestCounter);
    if (preMaterializeRequestCheck.changed) {
      const rotated = await rotateTargetGeneration(base44, config, 'rebuild_restarted_for_new_request_before_materialize');
      return Response.json({ accepted: true, deferred: true, reason: 'newer_rebuild_request', targetGeneration: rotated?.rebuild_target_generation }, { status: 202 });
    }

    // Materialize only after the complete source has replayed and every event
    // for this generation exists. listAll above guarantees there is no silent
    // 5,000-row truncation.
    const allKeys = new Set([...existingByKey.keys(), ...states.keys()]);
    for (const key of allKeys) {
      if (!(await renewRatingProcessingLock(owner))) throw new Error('rating_processing_lock_lost');
      const state = states.get(key) || defaultState(defaults);
      const existing = existingByKey.get(key);
      const [userId, timeControl] = parseKey(key);
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

    // Last-chance concurrency fence. If another rebuild request arrived during
    // materialization, keep the fail-closed guard and immediately schedule a
    // fresh generation. Normal rating processing cannot run in the interim.
    const finalRequestCheck = await newerRebuildRequestArrived(base44, capturedRequestCounter);
    if (finalRequestCheck.changed) {
      const rotated = await rotateTargetGeneration(base44, config, 'rebuild_restarted_for_new_request_after_materialize');
      return Response.json({ accepted: true, deferred: true, reason: 'newer_rebuild_request', targetGeneration: rotated?.rebuild_target_generation }, { status: 202 });
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
      requestCounter: capturedRequestCounter,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'rating_rebuild_failed';
    console.error(JSON.stringify({ event: 'rating_rebuild_failed', error: message }));

    if (base44 && config?.id && error instanceof RebuildGenerationConflict) {
      const rotated = await rotateTargetGeneration(base44, config, message).catch(() => null);
      return Response.json({
        accepted: true,
        deferred: true,
        reason: 'rebuild_generation_rotated',
        targetGeneration: rotated?.rebuild_target_generation,
      }, { status: 202 });
    }

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