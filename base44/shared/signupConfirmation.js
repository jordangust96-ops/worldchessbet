import { issueVerifiedEmailSession } from './mfaVerify.js';

// verifyEmail must verify the code with Base44 and resolve the user from
// the returned access token, never from a caller-supplied user or session.
export async function processSignupConfirmation({ email, otpCode, verifyEmail, store, userAgent = '' }) {
  if (typeof email !== 'string' || email.length > 254 || !email.includes('@') ||
      typeof otpCode !== 'string' || !/^\d{6}$/.test(otpCode)) {
    return { status:400, body:{ error:'invalid', message:'Enter your email and the 6-digit code.' } };
  }
  let proof;
  try {
    proof = await verifyEmail(email.trim(), otpCode);
  } catch (error) {
    const status = Number(error?.status || error?.response?.status);
    return { status:status === 429 ? 429 : status >= 500 ? 503 : 400,
      body:{ error:'confirmation_failed', message:status === 429
        ? 'Too many attempts. Please wait before trying again.'
        : status >= 500 ? 'Email confirmation is temporarily unavailable. Please try again.'
        : 'That code is invalid or expired. Please try again or request a new code.' } };
  }
  const user = proof?.user;
  if (!proof?.access_token || !user?.id || user.email?.toLowerCase() !== email.trim().toLowerCase() ||
      user.disabled === true || ['suspended','closed'].includes(user.account_state)) {
    return { status:403, body:{ error:'confirmation_failed', message:'Unable to confirm this account. Please sign in again.' } };
  }
  try {
    const session = await issueVerifiedEmailSession({ user, store, userAgent });
    return { status:200, body:{ ...session.body, access_token:proof.access_token } };
  } catch {
    // The provider may have consumed the code already. Keep the verified login
    // and use the existing email-security screen as an exceptional recovery.
    return { status:200, body:{ access_token:proof.access_token, session_pending:true } };
  }
}
