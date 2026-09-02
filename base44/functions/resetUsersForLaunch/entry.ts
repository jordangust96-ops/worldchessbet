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
//
// Implementation note: this applies the reset with one asServiceRole.update()
// call per non-admin user (the same pattern already proven elsewhere in this
// codebase — see getCurrentJurisdiction, manageIntegrityFlag,
// backfillFoundingPlayers) rather than entities.User.updateMany(). updateMany()
// has no other call site in this codebase to validate its exact request shape
// against, and an earlier version of this function that used it failed with an
// opaque 500 from the platform API. Per-user update() is slower for a large
// population but is well within a single request's time budget for a
// pre-launch user count, and it's the safe, already-working path.
const RESET_FIELDS = {
  account_state: 'provisional',
  identity_verification_status: 'not_started',
  jurisdiction_status: 'unknown',
  jurisdiction_vpn_detected: false,
  last_geolocation_status: 'not_checked',
  withdrawal_hold: false,
  // Cleared rather than removed — this SDK's single-record update() has no
  // $unset support, so these are reset to an empty value instead, matching
  // the pattern used by getCurrentJurisdiction for the same fields.
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

    // Single read of up to 5000 accounts covers the realistic population for
    // a pre-launch reset.
    const allUsers = await base44.asServiceRole.entities.User.list('created_date', 5000);

    let updatedCount = 0;
    let skippedAdminCount = 0;
    const failures = [];

    for (const u of allUsers) {
      if (u.role === 'admin') {
        skippedAdminCount += 1;
        continue;
      }
      try {
        await base44.asServiceRole.entities.User.update(u.id, RESET_FIELDS);
        updatedCount += 1;
      } catch (userError) {
        failures.push({ id: u.id, error: userError?.message || String(userError) });
      }
    }

    console.log(
      `[resetUsersForLaunch] admin=${user.id} updated=${updatedCount} skippedAdmins=${skippedAdminCount} failures=${failures.length}`
    );
    if (failures.length > 0) {
      console.error(`[resetUsersForLaunch] failures=${JSON.stringify(failures).slice(0, 2000)}`);
    }

    return Response.json({
      updated: updatedCount,
      skipped_admins: skippedAdminCount,
      failed: failures.length,
      failures: failures.slice(0, 20),
    });
  } catch (error) {
    console.error(`[resetUsersForLaunch] fatal error: ${error?.stack || error?.message || String(error)}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
