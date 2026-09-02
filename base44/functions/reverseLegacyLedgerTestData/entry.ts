import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// One-time, admin-only pre-launch cleanup: offsets every historical
// `settlement` LedgerEntry (confirmed pre-launch test/development artifacts)
// by writing one new `reversal` LedgerEntry per original. LedgerEntry rows are
// immutable (RLS blocks update/delete), so this never modifies or deletes an
// existing row — it only appends offsetting reversals.
//
// Safe to re-run: any original that already has a matching reversal
// (reversal_of_entry_id === original.id) is skipped.
//
// Never touches Wallet, SystemLedgerAccount, or any other financial entity.

function todayUTCDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const svc = base44.asServiceRole.entities;

    // All settlement-account ledger rows. Reversals we write also post to the
    // settlement account, so this single fetch includes both originals and any
    // prior cleanup reversals from a previous run.
    const settlementEntries = await svc.LedgerEntry.filter(
      { ledger_account: 'settlement' },
      null,
      5000
    );

    // Set of original entry ids that already have at least one reversal pointing
    // at them. Skips them so the function is idempotent.
    const reversedIds = new Set();
    for (const entry of settlementEntries) {
      if (entry.transaction_type === 'reversal' && entry.reversal_of_entry_id) {
        reversedIds.add(entry.reversal_of_entry_id);
      }
    }

    let createdCount = 0;
    let skippedCount = 0;
    let totalReversedAmount = 0;

    for (const original of settlementEntries) {
      // Never reverse a reversal; never reverse something already reversed.
      if (original.transaction_type === 'reversal') continue;
      if (reversedIds.has(original.id)) {
        skippedCount += 1;
        continue;
      }

      const debit = original.debit_amount || 0;
      const credit = original.credit_amount || 0;
      totalReversedAmount += debit;

      await svc.LedgerEntry.create({
        ledger_account: 'settlement',
        transaction_type: 'reversal',
        debit_amount: credit, // swapped from the original
        credit_amount: debit,  // swapped from the original
        reversal_of_entry_id: original.id,
        ledger_group_id: `pre-launch-reversal:${original.id}`,
        initiating_actor: 'administrator',
        initiating_actor_id: user.id,
        trigger_event: 'pre_launch_test_data_reversal',
        external_reference_type: 'none',
        currency: original.currency || 'USD',
        schema_version: 1,
        description: `Admin pre-launch cleanup reversal of test settlement entry ${original.id}, dated ${todayUTCDate()}.`,
      });

      createdCount += 1;
    }

    console.log(
      `[reverseLegacyLedgerTestData] admin=${user.id} created=${createdCount} skipped=${skippedCount} totalReversed=${totalReversedAmount}`
    );

    return Response.json({
      created: createdCount,
      already_reversed_skipped: skippedCount,
      total_amount_reversed: Math.round(totalReversedAmount * 100) / 100,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}