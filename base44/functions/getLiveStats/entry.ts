import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const onlineSince = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

    const [onlineUsers, liveMatches, availableMatches, startedTodayMatches] = await Promise.all([
      base44.asServiceRole.entities.User.filter({ last_active_at: { $gte: onlineSince } }),
      base44.asServiceRole.entities.Match.filter({ status: 'in_progress' }),
      base44.asServiceRole.entities.Match.filter({ status: 'searching', is_private: false }),
      base44.asServiceRole.entities.Match.filter({
        status: { $in: ['preparing', 'both_ready', 'in_progress', 'completed'] },
        created_date: { $gte: startOfToday },
      }),
    ]);

    const totalWageredToday = startedTodayMatches.reduce((sum, m) => sum + (m.wager_amount || 0) * 2, 0);

    return Response.json({
      playersOnline: onlineUsers.length,
      matchesLive: liveMatches.length,
      availableMatches: availableMatches.length,
      totalWageredToday,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});