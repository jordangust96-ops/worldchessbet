import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { requireAdminMfa } from '../../shared/mfa.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    const body = await req.json();
    const mfaError = await requireAdminMfa(base44, admin, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;

    const value = Number(body?.reconnectGracePeriodSeconds);
    if (!Number.isInteger(value) || value < 5 || value > 300) {
      return Response.json({ error: 'invalid_reconnect_grace_period' }, { status: 400 });
    }
    const rows = await base44.asServiceRole.entities.GameSettings.list();
    const settings = rows[0]
      ? await base44.asServiceRole.entities.GameSettings.update(rows[0].id, { reconnect_grace_period_seconds: value })
      : await base44.asServiceRole.entities.GameSettings.create({ reconnect_grace_period_seconds: value });
    return Response.json({ settings });
  } catch (error) {
    console.error(JSON.stringify({ event: 'update_game_settings_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
