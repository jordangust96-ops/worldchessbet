import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { healthSummary, parseJson } from '../../shared/siteHealthPolicy.ts';
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const [snapshots, configs] = await Promise.all([
      base44.asServiceRole.entities.SiteHealthSnapshot.filter({ key: 'current' }, '-checked_at', 1),
      base44.asServiceRole.entities.SiteHealthConfig.filter({ key: 'current' }, '-updated_date', 1),
    ]);
    const snapshot = snapshots[0] || null, config = configs[0] || null;
    return Response.json({
      ...healthSummary(snapshot), checked_at: snapshot?.checked_at || null,
      alert_delivery: snapshot?.alert_delivery || 'not_sent',
      last_alert_attempt_at: snapshot?.last_alert_attempt_at || null,
      last_alert_sent_at: snapshot?.last_alert_sent_at || null,
      history: parseJson(snapshot?.history_json, []), config,
      notice: 'Monitoring is observational. Missing coverage is unknown. Capacity requires a load-tested baseline. Browser measurements are client-reported. No financial or gameplay state is changed.',
    });
  } catch {
    return Response.json({ error: 'Health monitoring data could not be read' }, { status: 503 });
  }
});
