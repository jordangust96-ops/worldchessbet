import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if ('alerts_enabled' in body) {
      if (typeof body.alerts_enabled !== 'boolean') return Response.json({ error: 'Invalid alert setting' }, { status: 400 });
      data.alerts_enabled = body.alerts_enabled;
    }
    if ('credit_used' in body) {
      for (const k of ['credit_used', 'credit_allowance', 'pending_credit_allowance']) {
        if (!Number.isFinite(body[k]) || body[k] < 0) return Response.json({ error: 'Invalid credits' }, { status: 400 });
        data[k] = body[k];
      }
      const start = Date.parse(body.credit_cycle_started_at), renewal = Date.parse(body.credit_renews_at);
      if (!Number.isFinite(start) || !Number.isFinite(renewal) || start >= Date.now() || renewal <= Date.now() || body.credit_allowance <= 0)
        return Response.json({ error: 'Invalid credit cycle' }, { status: 400 });
      data.credit_cycle_started_at = new Date(start).toISOString();
      data.credit_renews_at = new Date(renewal).toISOString();
      data.credit_observed_at = new Date().toISOString();
    }
    if ('tested_concurrent_players' in body) {
      if (!Number.isInteger(body.tested_concurrent_players) || body.tested_concurrent_players < 0)
        return Response.json({ error: 'Invalid tested capacity' }, { status: 400 });
      data.tested_concurrent_players = body.tested_concurrent_players;
    }
    const svc = base44.asServiceRole.entities;
    const rows = await svc.SiteHealthConfig.filter({ key: 'current' }, '-updated_date', 1);
    if (!rows[0]) return Response.json({ error: 'Monitoring has not been initialized' }, { status: 409 });
    await svc.SiteHealthConfig.update(rows[0].id, data);
    return Response.json({ saved: true });
  } catch { return Response.json({ error: 'Unable to save monitoring settings' }, { status: 500 }); }
});
