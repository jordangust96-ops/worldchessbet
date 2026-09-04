import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const PAGE_SIZE = 500;

// Financial records are kept for at least two years from their recorded
// transaction activity. This sweep is deliberately monotonic: it only fills a
// missing deadline or extends an existing deadline, and never deletes or
// archives a transaction. WalletTransaction RLS separately denies deletion.
function twoYearDeadline(transaction: any) {
  const activityAt = transaction.processed_at || transaction.created_date;
  const activityDate = new Date(activityAt || '');
  if (!Number.isFinite(activityDate.getTime())) return null;
  activityDate.setUTCFullYear(activityDate.getUTCFullYear() + 2);
  return activityDate.toISOString();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let checked = 0;
    let stamped = 0;
    let skippedInvalidDate = 0;
    let offset = 0;

    while (true) {
      const page = await base44.asServiceRole.entities.WalletTransaction.filter(
        { launch_epoch: 2 },
        '-created_date',
        PAGE_SIZE,
        offset,
      );
      if (!page.length) break;

      for (const transaction of page) {
        checked += 1;
        const minimumRetention = twoYearDeadline(transaction);
        if (!minimumRetention) {
          skippedInvalidDate += 1;
          continue;
        }
        const currentDeadline = Date.parse(transaction.retention_until || '');
        if (Number.isFinite(currentDeadline) && currentDeadline >= Date.parse(minimumRetention)) {
          continue;
        }
        await base44.asServiceRole.entities.WalletTransaction.update(transaction.id, {
          retention_until: minimumRetention,
        });
        stamped += 1;
      }

      if (page.length < PAGE_SIZE) break;
      offset += page.length;
    }

    return Response.json({
      checked,
      stamped,
      skipped_invalid_date: skippedInvalidDate,
      policy: 'WalletTransaction records are retained for a minimum of two years from recorded activity; this sweep only extends retention and never deletes records.',
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'wallet_transaction_retention_sweep_failed',
      error: error?.message || 'unknown_error',
    }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
