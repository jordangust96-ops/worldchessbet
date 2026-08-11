import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { requireAdminMfa } from '../../shared/mfa.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';

const VALID_STATES = new Set(['provisional', 'verified', 'suspended', 'closed']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    const body = await req.json();
    const mfaError = await requireAdminMfa(base44, admin, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;

    const { userId, accountState, reason = '' } = body;
    if (typeof userId !== 'string' || !userId || !VALID_STATES.has(accountState)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const target = await base44.asServiceRole.entities.User.get(userId);
    if (!target) return Response.json({ error: 'user_not_found' }, { status: 404 });
    if (target.role === 'admin' && userId === admin.id && ['suspended', 'closed'].includes(accountState)) {
      return Response.json({ error: 'cannot_self_disable_admin' }, { status: 409 });
    }

    const previousState = target.account_state || 'provisional';
    const updated = await base44.asServiceRole.entities.User.update(userId, {
      account_state: accountState,
    });

    await recordIntegrationEvent(base44, {
      eventType: 'account.state_changed',
      aggregateType: 'user',
      aggregateId: userId,
      correlationId: userId,
      idempotencyKey: `account.state_changed:${userId}:${crypto.randomUUID()}`,
      actorType: 'administrator',
      actorId: admin.id,
      userId,
      status: accountState,
      result: reason || 'admin_action',
      eventData: { previous_state: previousState, new_state: accountState },
    });

    return Response.json({ user: updated });
  } catch (error) {
    console.error(JSON.stringify({ event: 'manage_user_account_state_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
