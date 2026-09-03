import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression test for Finding #9 from the full referential-integrity audit:
// User.identity_verification_status/account_state are a denormalized
// snapshot of a SocureIdentityVerification record with no reconciliation
// job checking they still agree. Nothing in the codebase can currently
// change SocureIdentityVerification out from under a 'verified' User
// snapshot (socureIdentityWebhook's own terminal-state guard refuses any
// further decision once a verification reaches a terminal outcome) -- but
// that is an invariant a future change could quietly break, silently
// leaving a user eligible to deposit/withdraw/enter paid contests under a
// no-longer-valid identity verification. reconcileIdentityVerification is
// the safety net: a scheduled sweep that re-checks the snapshot against the
// record of record and downgrades on any disagreement.

// --- Model: the sweep's core decision function.
function reconcileUser(user, verification) {
  if (user.identity_verification_status !== 'verified') return { changed: false, reason: 'not_flagged_verified' };
  if (user.identity_verification_provider !== 'socure' || !user.identity_provider_reference) {
    return { changed: false, reason: 'already_ineligible_on_other_fields' };
  }
  if (verification && verification.status === 'verified') return { changed: false, reason: 'in_sync' };

  const newIdentityStatus = verification?.status || 'failed';
  const updates = { identity_verification_status: newIdentityStatus };
  if (user.account_state === 'verified') updates.account_state = 'provisional';
  return { changed: true, updates };
}

{
  // In sync: no-op.
  const inSync = reconcileUser(
    { identity_verification_status: 'verified', identity_verification_provider: 'socure', identity_provider_reference: 'eval_1', account_state: 'verified' },
    { status: 'verified' }
  );
  assert.equal(inSync.changed, false, 'a User snapshot that still matches its SocureIdentityVerification record is left untouched');
}

{
  // Drift: the record of record no longer says verified (e.g. a future
  // revoke/re-review event) -- the User must be downgraded, never left
  // eligible on stale data.
  const drifted = reconcileUser(
    { identity_verification_status: 'verified', identity_verification_provider: 'socure', identity_provider_reference: 'eval_2', account_state: 'verified' },
    { status: 'rejected' }
  );
  assert.equal(drifted.changed, true, 'a User marked verified whose underlying record is no longer verified must be corrected, never left as-is');
  assert.equal(drifted.updates.identity_verification_status, 'rejected', 'the User snapshot is pulled down to match the actual record of record');
  assert.equal(drifted.updates.account_state, 'provisional', "account_state is downgraded from 'verified' so eligibility checks (isSocureIdentityVerified) immediately deny this user");
}

{
  // Missing record entirely (a reference that no longer resolves) -- fails
  // safe to 'failed', not left at 'verified'.
  const missing = reconcileUser(
    { identity_verification_status: 'verified', identity_verification_provider: 'socure', identity_provider_reference: 'eval_ghost', account_state: 'verified' },
    null
  );
  assert.equal(missing.changed, true, 'a reference that no longer resolves to any SocureIdentityVerification record is treated as drift, not ignored');
  assert.equal(missing.updates.identity_verification_status, 'failed', 'a missing record of record fails safe to failed, never silently kept as verified');
}

{
  // A user already suspended/closed for an unrelated reason must not have
  // that overwritten by this identity-only sweep.
  const alreadySuspended = reconcileUser(
    { identity_verification_status: 'verified', identity_verification_provider: 'socure', identity_provider_reference: 'eval_3', account_state: 'suspended' },
    { status: 'rejected' }
  );
  assert.equal(alreadySuspended.changed, true, 'identity_verification_status is still corrected even when account_state is already restricted for another reason');
  assert.equal(alreadySuspended.updates.account_state, undefined, "a dispute/compliance suspension this sweep did not cause is never touched — only account_state:'verified' is ever downgraded by it");
}

// --- Cross-check against the actual deployed source.
const [reconcileSrc, webhookSrc, workflowSrc] = await Promise.all([
  readFile(new URL('../base44/functions/reconcileIdentityVerification/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/socureIdentityWebhook/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/workflows/IdentityVerificationReconciliation.jsonc', import.meta.url), 'utf8'),
]);

assert.match(reconcileSrc, /identity_verification_status: 'verified' \},\s*\n\s*'-updated_date',\s*\n\s*500/, 'the sweep queries every User currently snapshotted as verified');
assert.match(reconcileSrc, /verification && verification\.status === 'verified'\) continue;/, 'a User in sync with its record of record is skipped, not rewritten');
assert.match(reconcileSrc, /if \(user\.account_state === 'verified'\) \{\s*\n\s*userUpdates\.account_state = 'provisional';/, "account_state is only ever downgraded by this sweep when it is currently 'verified' — never overriding an unrelated suspension/closure");
assert.doesNotMatch(reconcileSrc, /identity_verification_status: 'verified',\s*\n\s*\}\);\s*\n\s*driftedIds\.push/, 'the sweep never writes identity_verification_status back to verified — promotion stays the exclusive job of the webhook');
assert.match(reconcileSrc, /IntegrityFlag\.create\(\{/, 'a detected drift raises an IntegrityFlag for admin visibility, not just a silent downgrade');

const workflow = JSON.parse(workflowSrc);
assert.equal(workflow.definition.do[0].reconcile_identity_verification.with.function_name, 'reconcileIdentityVerification', 'the scheduled workflow invokes the reconciliation function by its actual folder name');
assert.equal(workflow.trigger.config.trigger_type, 'scheduled', 'the reconciliation sweep runs on a schedule, not only on demand');

// The invariant this sweep exists to guard is exactly the webhook's
// terminal-state replay guard — confirm it's still there (if it's ever
// removed, that's a sign the reconciliation sweep's rationale needs
// revisiting, not a reason to drop this assertion).
assert.match(webhookSrc, /OPEN_IDENTITY_VERIFICATION_STATES = new Set\(\['pending', 'review_required'\]\)/, "socureIdentityWebhook's terminal-state guard — the exact invariant this reconciliation sweep exists as a safety net for — is unchanged");

console.log('Identity verification reconciliation validation passed.');
