import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Public endpoint reached from the "Unsubscribe" link/button in marketing and
// announcement emails (e.g. Founding Player notification). No login is
// required since the recipient may be clicking from their email client
// without an active session.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const { userId } = await req.json();
    if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

    const targetUser = await base44.asServiceRole.entities.User.get(userId);
    if (!targetUser) return Response.json({ error: 'User not found' }, { status: 404 });

    await base44.asServiceRole.entities.User.update(userId, { marketing_email_opt_out: true });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}