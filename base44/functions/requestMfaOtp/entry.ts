import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 5;

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateOtp() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % 1000000).toString().padStart(6, '0');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const recentCodes = await base44.asServiceRole.entities.MfaCode.filter({ user_id: user.id }, '-created_date', 10);

    const lastCode = recentCodes[0];
    if (lastCode) {
      const elapsed = now.getTime() - new Date(lastCode.created_date).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return Response.json(
          { error: 'cooldown', message: `Please wait ${waitSeconds}s before requesting another code.` },
          { status: 429 }
        );
      }
    }

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const requestsLastHour = recentCodes.filter((c) => new Date(c.created_date) > oneHourAgo).length;
    if (requestsLastHour >= MAX_REQUESTS_PER_HOUR) {
      await base44.asServiceRole.entities.MfaAuditLog.create({
        user_id: user.id,
        email: user.email,
        event: 'rate_limited',
        detail: 'Too many OTP requests within an hour',
      });
      return Response.json(
        { error: 'rate_limited', message: 'Too many verification code requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Invalidate any still-active codes so only the newest one can ever be used.
    const activeCodes = recentCodes.filter((c) => c.status === 'active');
    for (const c of activeCodes) {
      await base44.asServiceRole.entities.MfaCode.update(c.id, { status: 'invalidated' });
    }

    const code = generateOtp();
    const salt = crypto.randomUUID();
    const codeHash = await sha256Hex(salt + code);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();

    await base44.asServiceRole.entities.MfaCode.create({
      user_id: user.id,
      email: user.email,
      code_hash: codeHash,
      salt,
      expires_at: expiresAt,
      attempts: 0,
      status: 'active',
    });

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: user.email,
      subject: 'Your ChessBet verification code',
      body: `Your ChessBet verification code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    });

    await base44.asServiceRole.entities.MfaAuditLog.create({
      user_id: user.id,
      email: user.email,
      event: 'otp_requested',
      detail: 'OTP generated and sent to email',
    });

    return Response.json({ success: true, expires_at: expiresAt, cooldown_seconds: 60 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});