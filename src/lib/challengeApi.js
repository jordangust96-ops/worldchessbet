import { base44 } from '@/api/base44Client';
import { getMfaSessionToken } from '@/lib/mfaSession';
import { setPostAuthRedirect } from '@/lib/postAuthRedirect';
import { getBrowserGeolocation } from '@/lib/deviceContext';
export { CHALLENGE_TERMS, CHALLENGE_NOT_RESERVED, VALID_INVITE, validEntry } from '../../base44/shared/challengePolicy.js';

export async function challengeRequest(action, body = {}) {
  const payload = { ...body, action, ...(action === 'view' ? {} : { sessionToken: getMfaSessionToken() }) };
  // Readiness is read-only. A brief server-side rate limit can clear without
  // making the player restart; never automatically retry a money operation.
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await base44.functions.invoke('manageChallenge', payload);
      return data;
    } catch (error) {
      if (action !== 'readiness' || attempt >= 1 || error?.response?.status !== 503) throw error;
      await new Promise(resolve => setTimeout(resolve, 12000));
    }
  }
}
export async function challengeLocationContext() {
  const geo = await getBrowserGeolocation();
  return { browserGeoPermission: geo.permission, browserLatitude: geo.latitude,
    browserLongitude: geo.longitude, browserAccuracyMeters: geo.accuracyMeters };
}
export function challengeErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unable to update this challenge. Please try again.';
}
export function handleChallengeGate(error, navigate, path) {
  const action = error?.response?.data?.action || error?.response?.data?.code;
  if (action === 'login_required' || action === 'mfa_required') {
    setPostAuthRedirect(path);
    navigate(action === 'login_required' ? '/login' : '/verify-mfa');
    return true;
  }
  if (action === 'policies_required') {
    setPostAuthRedirect(path);
    const code = /^\/challenge\/([a-f0-9]{32})$/.exec(path)?.[1] ||
      /^[a-f0-9]{32}$/.exec(new URLSearchParams(path.split('?')[1] || '').get('challenge') || '')?.[0];
    navigate(code ? `/play?resumeChallenge=${code}` : '/play');
    return true;
  }
  return false;
}
export function saveChallengeContext(userId, inviteCode) {
  if (!userId || !/^[a-f0-9]{32}$/.test(inviteCode || '')) return;
  try { localStorage.setItem(`chessbet_challenge_context:${userId}`, JSON.stringify({ inviteCode, savedAt:Date.now() })); } catch { /* Storage is optional. */ }
}
export function readChallengeContext(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(`chessbet_challenge_context:${userId}`) || 'null');
    return value && Date.now()-value.savedAt < 14*86400000 && /^[a-f0-9]{32}$/.test(value.inviteCode) ? value.inviteCode : null;
  } catch { return null; }
}
