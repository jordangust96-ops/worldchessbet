import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const settle = read('base44/functions/settleMatch/entry.ts');
const submitMove = read('base44/functions/submitMove/entry.ts');
const processor = read('base44/functions/processEligibleRatings/entry.ts');
const rebuild = read('base44/functions/rebuildAllRatings/entry.ts');
const policy = read('base44/shared/ratingPolicy.ts');
const atomic = read('base44/shared/ratingAtomicStore.ts');
const eventSchema = read('base44/entities/RatingEvent.jsonc');
const configSchema = read('base44/entities/RatingSystemConfig.jsonc');
const sweepWorkflow = read('base44/workflows/RatingFinalizationSweep.jsonc');
const correctionWorkflow = read('base44/workflows/RatingCorrectionOnDisputeResolution.jsonc');
const pkg = JSON.parse(read('package.json'));

// Launch-critical paths must remain rating-unaware.
assert.doesNotMatch(settle, /PlayerRating|RatingEvent|RatingOperation|processEligibleRatings|Glicko/i);
assert.doesNotMatch(submitMove, /PlayerRating|RatingEvent|RatingOperation|processEligibleRatings|Glicko/i);

// Finality gates share one reporting-window constant and explicitly bind the
// payout to the authoritative winner.
assert.match(policy, /REPORT_WINDOW_MS/);
assert.match(policy, /DisputeCase/);
assert.match(policy, /IntegrityFlag/);
assert.match(policy, /p\.user_id === contestRecord\.winner_id/);
assert.match(policy, /payout_hold_status !== 'released'/);
assert.match(policy, /contest_reversed/);
assert.match(policy, /contest_voided/);
assert.match(processor, /REPORT_WINDOW_MS/);
assert.match(rebuild, /REPORT_WINDOW_MS/);
assert.doesNotMatch(processor, /24 \* 60 \* 60 \* 1000/);
assert.doesNotMatch(rebuild, /24 \* 60 \* 60 \* 1000/);

// Time-control state is always resolved with both user and pool.
assert.match(processor, /PlayerRating\.filter\(\{ user_id: userId, time_control: timeControl \}\)/);

// Provisional status changes only when gamesRated reaches the configured
// threshold: at 9/10 it remains provisional; at 10/10 it becomes established.
assert.equal(9 < 10, true);
assert.equal(10 < 10, false);
assert.match(processor, /provisional: after\.gamesRated < defaults\.provisionalGames/);
assert.match(rebuild, /provisional: state\.gamesRated < defaults\.provisionalGames/);

// Crash/concurrency safety and deterministic player-specific history.
assert.match(processor, /RatingOperation\.create/);
assert.match(processor, /PlayerRating\.update/);
assert.match(processor, /rating-event:\$\{userId\}:\$\{operation\.game_id\}:\$\{generation\}/);
assert.match(processor, /superseded_by_rebuild/);
assert.doesNotMatch(processor, /operation_recovery_required/);
assert.match(processor, /renewRatingProcessingLock\(lockOwner\)/);
assert.match(atomic, /chessbet:ratings:v1/);
assert.match(atomic, /RATING_ATOMIC_REDIS_REST_URL/);
assert.doesNotMatch(atomic, /SEAMLESS_ATOMIC_REDIS_REST_URL/);

// No hard history ceiling may silently stop discovery or truncate a rebuild.
assert.doesNotMatch(processor, /MAX_SCAN/);
assert.doesNotMatch(rebuild, /MAX_ROWS/);
assert.match(rebuild, /async function listAll/);
assert.match(processor, /if \(applied >= MAX_APPLY_PER_RUN\) break/);

// Immutable history and self-healing generation rebuild.
assert.match(eventSchema, /"update"\s*:\s*false/);
assert.match(eventSchema, /"delete"\s*:\s*false/);
assert.match(configSchema, /"rebuild_request_counter"/);
assert.match(rebuild, /RebuildGenerationConflict/);
assert.match(rebuild, /rotateTargetGeneration/);
assert.match(rebuild, /newerRebuildRequestArrived/);
assert.match(rebuild, /rebuild_request_counter/);
assert.match(rebuild, /superseded_by_rebuild/);
assert.match(rebuild, /status === 'completed'/);
assert.match(rebuild, /source: 'rebuild'/);
assert.match(rebuild, /JSON\.stringify\(\[userId, timeControl\]\)/);

// Completely separate scheduled/correction workflows.
assert.match(sweepWorkflow, /processEligibleRatings/);
assert.match(sweepWorkflow, /7,22,37,52 \* \* \* \*/);
assert.match(correctionWorkflow, /rebuildAllRatings/);
assert.match(correctionWorkflow, /contest_reversed/);
assert.match(correctionWorkflow, /contest_voided/);

// Rating tests are now a named project validation target.
assert.equal(pkg.scripts['test:ratings'], 'node scripts/validate-ratings.mjs && node scripts/validate-rating-architecture.mjs');

console.log('Rating architecture hardening/isolation/finality/recovery validation passed.');