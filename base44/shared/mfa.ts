async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function requireAdminMfa(base44, admin, sessionToken, userAgent = '') {
  if (!admin) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (admin.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });
  if (typeof sessionToken !== 'string' || sessionToken.length < 32 || sessionToken.length > 256) {
    return Response.json({ error: 'mfa_required' }, { status: 401 });
  }

  const tokenHash = await sha256Hex(sessionToken);
  const sessions = await base44.asServiceRole.entities.MfaSession.filter({
    user_id: admin.id,
    token_hash: tokenHash,
    revoked: false,
  }, '-created_date', 1);
  const session = sessions[0];
  if (!session || new Date() >= new Date(session.expires_at)) {
    if (session) await base44.asServiceRole.entities.MfaSession.update(session.id, { revoked: true });
    return Response.json({ error: 'mfa_required' }, { status: 401 });
  }

  const deviceHash = await sha256Hex(userAgent || '');
  if (deviceHash !== session.device_hash) {
    await base44.asServiceRole.entities.MfaSession.update(session.id, { revoked: true });
    return Response.json({ error: 'mfa_required' }, { status: 401 });
  }
  return null;
}
