import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Restricted to this specific admin account, per explicit product request —
// not a general admin-facing report.
const ALLOWED_ADMIN_EMAIL = 'jordangust96@gmail.com';
const DAYS_TO_SHOW = 14;
const FETCH_LIMIT = 2000;

function dayKey(dateStr) {
  return new Date(dateStr).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' || user.email !== ALLOWED_ADMIN_EMAIL) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [visits, declines, matches] = await Promise.all([
      base44.asServiceRole.entities.SiteVisit.list('-created_date', FETCH_LIMIT),
      base44.asServiceRole.entities.MatchDeclineLog.list('-created_date', FETCH_LIMIT),
      base44.asServiceRole.entities.Match.list('-created_date', FETCH_LIMIT),
    ]);

    const today = new Date();
    const days = [];
    for (let i = DAYS_TO_SHOW - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    const stats = {};
    for (const day of days) {
      stats[day] = {
        totalVisits: 0,
        uniqueVisitors: new Set(),
        matchesHosted: 0,
        matchesAccepted: 0,
        matchesDeclined: 0,
        matchesFinished: 0,
        wagerSum: 0,
        wagerCount: 0,
      };
    }

    for (const v of visits) {
      const day = dayKey(v.created_date);
      if (!stats[day]) continue;
      stats[day].totalVisits += 1;
      if (v.created_by_id) stats[day].uniqueVisitors.add(v.created_by_id);
    }

    for (const d of declines) {
      const day = dayKey(d.created_date);
      if (stats[day]) stats[day].matchesDeclined += 1;
    }

    for (const m of matches) {
      const hostedDay = dayKey(m.created_date);
      if (stats[hostedDay]) {
        stats[hostedDay].matchesHosted += 1;
        stats[hostedDay].wagerSum += m.wager_amount || 0;
        stats[hostedDay].wagerCount += 1;
      }
      if (m.preparation_started_at) {
        const acceptedDay = dayKey(m.preparation_started_at);
        if (stats[acceptedDay]) stats[acceptedDay].matchesAccepted += 1;
      }
      if (m.status === 'completed' && m.completed_at) {
        const finishedDay = dayKey(m.completed_at);
        if (stats[finishedDay]) stats[finishedDay].matchesFinished += 1;
      }
    }

    const result = days.map((day) => {
      const s = stats[day];
      return {
        date: day,
        totalVisits: s.totalVisits,
        uniqueVisits: s.uniqueVisitors.size,
        matchesHosted: s.matchesHosted,
        matchesAccepted: s.matchesAccepted,
        matchesDeclined: s.matchesDeclined,
        matchesFinished: s.matchesFinished,
        avgWager: s.wagerCount > 0 ? Math.round((s.wagerSum / s.wagerCount) * 100) / 100 : 0,
      };
    });

    return Response.json({ days: result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});