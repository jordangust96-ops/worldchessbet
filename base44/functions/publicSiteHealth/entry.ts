import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
// Public monitor endpoint: returns only coarse availability, never details,
// configuration, record IDs, credentials, traffic, or provider information.
Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405 });
  try {
    const base44 = createClientFromRequest(req);
    const rows = await base44.asServiceRole.entities.SiteHealthSnapshot.filter({ key: 'current' }, '-checked_at', 1);
    const latest = rows[0];
    const age = Date.now() - Date.parse(latest?.checked_at || '');
    const ok = Number.isFinite(age) && age >= 0 && age < 35 * 60000 && latest.status !== 'critical';
    return Response.json({ status: ok ? 'ok' : 'unavailable' }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
});
