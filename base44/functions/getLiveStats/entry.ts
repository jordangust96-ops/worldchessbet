import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  ONLINE_WINDOW_MS,
  countEntities,
  publicAvailableMatchQuery,
} from '../../shared/marketplaceStats.ts';

const AGGREGATE_CACHE_MS = 5000;
let aggregateCache = null;
let aggregateRequest = null;

async function loadAggregateStats(base44) {
  const now = Date.now();
  if (aggregateCache && now - aggregateCache.cachedAt < AGGREGATE_CACHE_MS) {
    return aggregateCache;
  }
  if (aggregateRequest) return aggregateRequest;

  aggregateRequest = (async () => {
    const generatedAt = new Date();
    const onlineSince = new Date(generatedAt.getTime() - ONLINE_WINDOW_MS).toISOString();
    const [playersOnline, matchesLive, publicAvailableMatches] = await Promise.all([
      countEntities(base44.asServiceRole.entities.User, {
        role: 'user',
        account_state: { $ne: 'closed' },
        last_active_at: { $gte: onlineSince },
      }),
      countEntities(base44.asServiceRole.entities.Match, { status: 'in_progress' }),
      countEntities(
        base44.asServiceRole.entities.Match,
        publicAvailableMatchQuery()
      ),
    ]);

    return {
      playersOnline,
      matchesLive,
      publicAvailableMatches,
      generatedAt: generatedAt.toISOString(),
      cachedAt: generatedAt.getTime(),
    };
  })();

  try {
    aggregateCache = await aggregateRequest;
    return aggregateCache;
  } finally {
    aggregateRequest = null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Aggregate work is shared briefly across viewers and concurrent requests.
    // The one viewer-specific lookup preserves the meaning of "available to you"
    // by excluding the viewer's own public challenge.
    const [aggregates, ownPublicChallenges] = await Promise.all([
      loadAggregateStats(base44),
      base44.asServiceRole.entities.Match.filter({
        status: 'searching',
        is_private: { $ne: true },
        player1_id: user.id,
      }, 'created_date', 1),
    ]);
    const availableMatches = Math.max(
      0,
      aggregates.publicAvailableMatches - (ownPublicChallenges.length > 0 ? 1 : 0)
    );

    return Response.json({
      playersOnline: aggregates.playersOnline,
      matchesLive: aggregates.matchesLive,
      availableMatches,
      generatedAt: aggregates.generatedAt,
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