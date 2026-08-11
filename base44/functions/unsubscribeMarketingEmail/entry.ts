import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const { userId, token } = await req.json();
    if (typeof userId !== 'string' || !userId || typeof token !== 'string' || token.length < 20 || token.length > 256) {
      return Response.json({ error: 'invalid_unsubscribe_link' }, { status: 400 });
    }

    const targetUser = await base44.asServiceRole.entities.User.get(userId);
    if (!targetUser || !constantTimeEqual(token, targetUser.marketing_unsubscribe_token || '')) {
      return Response.json({ error: 'invalid_unsubscribe_link' }, { status: 400 });
    }

    await base44.asServiceRole.entities.User.update(userId, { marketing_email_opt_out: true });
    return Response.json({ success: true });
  } catch (error) {
    console.error(JSON.stringify({ event: 'unsubscribe_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
