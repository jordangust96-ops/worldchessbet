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
const sweepWorkflow = read('base44/workflows/RatingFinalizationSweep.jsonc');
const correctionWorkflow = read('base44/workflows/RatingCorrectionOnDisputeResolution.jsonc');

// Launch-critical paths must remain rating-unaware.
assert.doesNotMatch(settle, /PlayerRating|RatingEvent|processEligibleRatings|Glicko/i);
assert.doesNotMatch(submitMove, /PlayerRating|RatingEvent|processEligibleRatings|Glicko/i);

// Finality gates.
assert.match(policy, /REPORT_WINDOW_MS/);
assert.match(policy, /DisputeCase/);
assert.match(policy, /IntegrityFlag/);
assert.match(policy, /payout_hold_status !== 'released'/);
assert.match(policy, /contest_reversed/);
assert.match(policy, /contest_voided/);

// Crash/concurrency safety and deterministic player-specific history.
assert.match(processor, /RatingOperation\.create/);
assert.match(processor, /PlayerRating\.update/);
assert.match(
  processor,
  /const operation = existingOperation \|\| await prepareOperation\([\s\S]*?await applyPreparedOperation\(base44, operation/,
  'runtime sweep must prepare/recover the contest operation before applying materialized player ratings'
);
assert.match(processor, /rating-event:\$\{userId\}:\$\{operation\.game_id\}:\$\{generation\}/);
assert.match(atomic, /chessbet:ratings:v1/);
assert.match(atomic, /SEAMLESS_ATOMIC_REDIS_REST_URL/);

// Immutable history and generation rebuild.
assert.match(eventSchema, /"update"\s*:\s*false/);
assert.match(eventSchema, /"delete"\s*:\s*false/);
assert.match(rebuild, /current_generation/);
assert.match(rebuild, /source: 'rebuild'/);
assert.match(rebuild, /status === 'completed'/);

// Completely separate scheduled/correction workflows.
assert.match(sweepWorkflow, /processEligibleRatings/);
assert.match(sweepWorkflow, /7,22,37,52 \* \* \* \*/);
assert.match(correctionWorkflow, /rebuildAllRatings/);
assert.match(correctionWorkflow, /contest_reversed/);
assert.match(correctionWorkflow, /contest_voided/);

console.log('Rating architecture isolation/finality/recovery validation passed.');
