import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Lets an admin manually open an IntegrityFlag (e.g. a reported concern that
// doesn't fit an automatic rule yet). Admin-only. Never suspends users or
// touches funds — it only creates a flag for review.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { userId, matchId, flagType, severity, notes } = await req.json();
    if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

    const flag = await base44.asServiceRole.entities.IntegrityFlag.create({
      user_id: userId,
      match_id: matchId || '',
      flag_type: flagType || 'manual',
      severity: severity || 'low',
      status: 'open',
      notes: notes || '',
      assigned_admin_id: admin.id,
    });

    await base44.asServiceRole.entities.IntegrityAuditLog.create({
      flag_id: flag.id,
      admin_id: admin.id,
      admin_name: admin.full_name || admin.email,
      action: 'flag_created',
      new_status: 'open',
      notes: notes || 'Manually created by admin.',
    });

    const flagSeverity = severity || 'low';
    if (flagSeverity === 'high') {
      const highFlags = await base44.asServiceRole.entities.IntegrityFlag.filter({ user_id: userId, severity: 'high' });
      const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
      const targetUser = await base44.asServiceRole.entities.User.get(userId);
      for (const a of admins) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: a.email,
          subject: 'ChessBet Integrity Alert',
          body: `A high-severity integrity flag was manually created.\n\nUser: ${targetUser?.full_name || targetUser?.email || userId}\nTotal high-severity flags: ${highFlags.length}\n\nPlease review in the Integrity Review Queue.`,
        }).catch(() => {});
      }
    }

    return Response.json({ flag });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});