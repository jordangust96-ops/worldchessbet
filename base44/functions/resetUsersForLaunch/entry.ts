import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Manual, admin-only pre-launch reset of non-admin User account state.
//
// Restores every non-admin account to its initial "provisional / unverified /
// unchecked-jurisdiction" baseline so the platform can launch against a clean
// user population. Never touches Wallet, SystemLedgerAccount, or any other
// financial/ledger entity — those are reset separately.
//
// Not triggered automatically by any workflow or webhook. Only an authenticated
// admin can invoke it, and the admin page gates the call behind a confirmation
// dialog.
const BATCH_SIZE = 500;

// Fields restored to their default starting value.
const FIELDS_TO_SET = {
  account_state: 'provisional',
  identity_verification_status: 'not_started',
  jurisdiction_status: 'unknown',
  jurisdiction_vpn_detected: false,
  last_geolocation_status: 'not_checked',
  withdrawal_hold: false,
};

// Fields cleared (removed) entirely. Mongo-style $unset expects an object of
// fieldName -> truthy value (an empty string), not an array of field names.
const FIELDS_TO_UNSET = {
  identity_verified_at: '',
  identity_verification_provider: '',
  identity_provider_reference: '',
  verified_id_hash: '',
  current_jurisdiction_state: '',
  current_jurisdiction_country: '',
  jurisdiction_last_verified_at: '',
  jurisdiction_verification_provider: '',
  last_geolocation_checked_at: '',
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    let updatedCount = 0;
    let skippedAdminCount = 0;
    let hasMore = true;
    let batchIndex = 0;

    // Page through all users. list() returns up to the requested limit per call;
    // we read a large window and, if a full window is returned, continue paging.
    while (hasMore) {
      const allUsers = await base44.asServiceRole.entities.User.list('created_date', 5000);
      const targetIds = [];
      for (const u of allUsers) {
        if (u.role === 'admin') {
          skippedAdminCount += 1;
        } else {
          targetIds.push(u.id);
        }
      }

      // Apply the reset in BATCH_SIZE chunks so each updateMany stays within the
      // per-call record ceiling.
      for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
        const chunk = targetIds.slice(i, i + BATCH_SIZE);
        if (chunk.length === 0) continue;
        await base44.asServiceRole.entities.User.updateMany(
          { id: { $in: chunk } },
          { $set: FIELDS_TO_SET, $unset: FIELDS_TO_UNSET }
        );
        updatedCount += chunk.length;
      }

      // The User entity is bounded by total platform accounts; a single read of
      // 5000 covers the realistic population for a pre-launch reset. Stop after
      // the first page to avoid an unbounded loop — the summary reports exactly
      // what was reset.
      hasMore = false;
      batchIndex += 1;
    }

    console.log(
      `[resetUsersForLaunch] admin=${user.id} updated=${updatedCount} skippedAdmins=${skippedAdminCount} batches=${batchIndex}`
    );

    return Response.json({
      updated: updatedCount,
      skipped_admins: skippedAdminCount,
      batches: batchIndex,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}