import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Admin-only: completes identity verification for a user. Each individual may
// hold only one Account — the submitted ID number is hashed and checked
// against every other user's stored hash. A match denies the verification
// (the account is a suspected duplicate) instead of promoting it to Verified.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { userId, idNumber } = await req.json();
    if (!userId || !idNumber || typeof idNumber !== 'string' || !idNumber.trim()) {
      return Response.json({ error: 'userId and idNumber are required' }, { status: 400 });
    }

    const targetUser = await base44.asServiceRole.entities.User.get(userId);
    if (!targetUser) return Response.json({ error: 'User not found' }, { status: 404 });

    const normalized = idNumber.trim().toUpperCase();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    const idHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const matches = await base44.asServiceRole.entities.User.filter({ verified_id_hash: idHash });
    const duplicate = matches.find((u) => u.id !== userId);

    if (duplicate) {
      await base44.asServiceRole.entities.IntegrityFlag.create({
        user_id: userId,
        flag_type: 'duplicate_identity_document',
        severity: 'high',
        status: 'open',
        assigned_admin_id: admin.id,
        description: `Submitted ID matches an existing account (${duplicate.id}). Verification denied.`,
      });
      return Response.json({
        success: false,
        duplicate: true,
        message: 'This ID is already associated with an existing account. Verification denied.',
      });
    }

    const updatedUser = await base44.asServiceRole.entities.User.update(userId, {
      verified_id_hash: idHash,
      identity_verification_status: 'verified',
      identity_verified_at: new Date().toISOString(),
      account_state: 'verified',
    });

    return Response.json({ success: true, user: updatedUser });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});