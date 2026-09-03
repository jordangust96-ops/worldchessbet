import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const {
  buildCheckLookupPath,
  mapTransactionStatus,
  PATH_CHECK,
} = await import('../base44/shared/seamlessAchPure.js');

assert.equal(PATH_CHECK, '/check');
assert.equal(buildCheckLookupPath('abc-123'), '/check/abc-123');
assert.equal(buildCheckLookupPath('id/with/slash'), '/check/id%2Fwith%2Fslash');
assert.throws(() => buildCheckLookupPath(''), /check_id/);

for (const status of ['Cancelled', 'Voided', 'Failed', 'Declined', 'Unpaid']) {
  assert.equal(mapTransactionStatus(status), 'failed', `${status} is terminal and failed`);
}
assert.equal(mapTransactionStatus('Processed'), 'completed');
assert.equal(mapTransactionStatus('Pending'), 'pending');

const recovery = await read('base44/functions/reconcile-seamless-ach-statuses/entry.ts');
assert.match(recovery, /seamlessRequest\('GET', buildCheckLookupPath\(providerRef\)\)/,
  'recovery uses the confirmed single-check GET endpoint');
assert.match(recovery, /provider_key: SEAMLESS_PROVIDER_KEY,\s+wallet_transaction_id: candidate\.id,\s+}/,
  'recovery selects the persisted provider check_id regardless of its last local status');
assert.match(recovery, /!String\(ref\.external_reference_id\)\.startsWith\('chessbet-'\)/,
  'ChessBet labels are explicitly excluded as lookup keys');
assert.match(recovery, /claimWebhookEvent\(idemKey, providerRef, owner\)/,
  'recovered statuses share the webhook atomic transaction claim');
assert.match(recovery, /applyWebhookEvent\(tx, \{ status: providerStatus \}\)/,
  'recovered statuses use the same money state machine');
assert.match(recovery, /Number\(tx\.amount\)/,
  'financial posting uses the already-recorded ChessBet amount');
assert.match(recovery, /MAX_LOOKUP_AGE_MS = 90/,
  'automated lookups have a bounded 90-day window');
assert.match(recovery, /BACKOFF_MS/,
  'per-transaction lookups back off');
assert.match(recovery, /\{ status: 'completed', integration_status: 'settled' }/,
  'settled ACH items remain eligible for bounded late-return monitoring');
assert.match(recovery, /POST_SETTLEMENT_INTERVAL_MS = 24/,
  'post-settlement provider checks are limited to daily cadence');
assert.match(recovery, /isClosedTrackerState\(tracker\?\.state\)/,
  'manual-review and terminal trackers are not recreated on every sweep');
assert.match(recovery, /\['failed', 'reversed', 'manual_review', 'settled'\]/,
  'closed tracker states are explicit and fail closed');
assert.match(recovery, /priority = Number\(a\.status === 'completed'\)/,
  'unresolved ACH transactions are processed before settled monitoring');
assert.match(recovery, /Post-settlement monitoring window completed/,
  'settled monitoring stops cleanly after the bounded window');
assert.doesNotMatch(recovery, /seamlessRequest\('GET',[\s\S]*label/,
  'recovery never sends a label as a lookup query');

const workflow = JSON.parse(await read('base44/workflows/SeamlessAchStatusRecovery.jsonc'));
assert.equal(workflow.trigger.config.cron_expression, '*/15 * * * *');
assert.equal(
  workflow.definition.do[0].reconcile_seamless_ach_statuses.with.function_name,
  'reconcile-seamless-ach-statuses'
);

const schema = JSON.parse(await read('base44/entities/seamless-status-reconciliation.jsonc'));
assert.equal(schema.name, 'SeamlessStatusReconciliation');
assert.deepEqual(schema.rls.read, { user_condition: { role: 'admin' } });
assert.equal(schema.rls.delete, false);

const consent = await read('base44/shared/achAuthorization.js');
const enrollment = await read('base44/functions/createVerifiedSeamlessFundingSource/entry.ts');
assert.match(consent, /draft-2026-09-03-v2/,
  'authorization remains marked draft while Seamless Risk review is pending');
assert.ok(
  enrollment.indexOf('if (!seamlessThirdPartyFundingEnabled())') <
  enrollment.indexOf('SeamlessFundingSourceEnrollment.create'),
  'third-party funding remains inert until explicit provider approval'
);

console.log('Seamless ACH status recovery verification passed.');
