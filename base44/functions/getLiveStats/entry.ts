import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  ONLINE_WINDOW_MS,
  countEntities,
  publicAvailableMatchQuery,
} from '../../shared/marketplaceStats.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const generatedAt = new Date();
    const onlineSince = new Date(generatedAt.getTime() - ONLINE_WINDOW_MS).toISOString();

    // Count every matching row in pages. Calling filter() without an explicit
    // limit silently caps these headline metrics at the SDK default page size.
    const [playersOnline, matchesLive, availableMatches] = await Promise.all([
      countEntities(base44.asServiceRole.entities.User, {
        role: 'user',
        account_state: { $ne: 'closed' },
        last_active_at: { $gte: onlineSince },
      }),
      countEntities(base44.asServiceRole.entities.Match, { status: 'in_progress' }),
      countEntities(
        base44.asServiceRole.entities.Match,
        publicAvailableMatchQuery(user.id)
      ),
    ]);

    return Response.json({
      playersOnline,
      matchesLive,
      availableMatches,
      generatedAt: generatedAt.toISOString(),
      onlineWindowSeconds: ONLINE_WINDOW_MS / 1000,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'live_stats_failed',
      error: error?.message || 'unknown_error',
    }));
    return Response.json({ error: 'Unable to load live marketplace activity' }, { status: 500 });
  }
});