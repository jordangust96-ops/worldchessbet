import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
const allowed = new Set(['submitMove', 'getGameClock', 'gameHeartbeat']);
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const raw = await req.text();
    if (raw.length > 12000) return Response.json({ error: 'Payload too large' }, { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    if (!Array.isArray(body.samples) || body.samples.length < 1 || body.samples.length > 3)
      return Response.json({ error: 'Invalid samples' }, { status: 400 });
    const seen = new Set();
    const samples = [];
    for (const s of body.samples) {
      if (!allowed.has(s.name) || seen.has(s.name)) return Response.json({ error: 'Invalid metric' }, { status: 400 });
      seen.add(s.name);
      const fields = ['count', 'server_errors', 'network_errors', 'rate_limits', 'slow_count'];
      if (fields.some(k => !Number.isInteger(s[k]) || s[k] < 0 || s[k] > 1000) || s.count < 1 ||
          fields.slice(1).some(k => s[k] > s.count) || s.server_errors + s.network_errors + s.rate_limits > s.count)
        return Response.json({ error: 'Invalid counts' }, { status: 400 });
      samples.push(Object.fromEntries(['name', ...fields].map(k => [k, s[k]])));
    }
    const svc = base44.asServiceRole.entities;
    const existing = await svc.GameHealthTelemetry.filter({ user_id: user.id }, '-recorded_at', 1);
    const now = Date.now();
    if (existing[0] && now - Date.parse(existing[0].recorded_at) < 110000)
      return Response.json({ accepted: false, reason: 'sample_interval' });
    const payload = { user_id: user.id, recorded_at: new Date(now).toISOString(),
      window_started_at: new Date(now - 120000).toISOString(), samples_json: JSON.stringify(samples) };
    if (existing[0]) await svc.GameHealthTelemetry.update(existing[0].id, payload);
    else await svc.GameHealthTelemetry.create(payload);
    return Response.json({ accepted: true });
  } catch {
    return Response.json({ error: 'Telemetry unavailable' }, { status: 503 });
  }
});
