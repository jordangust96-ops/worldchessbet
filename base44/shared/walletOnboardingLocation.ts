import { hasReliableLocationEvidence } from './jurisdictionGates.js';
import { isLocationApproved } from './jurisdictionRegions.js';
// Wallet onboarding evidence must continue to satisfy the current quality policy.
// Reuse genuine approvals recorded before this policy change, never User fields
// or an identity/bank status. Later gameplay checks cannot grant/revoke onboarding.
const LEGACY_CUTOFF = '2026-09-10T23:32:05.000Z';
export function isWalletLocationEvidence(row, userId) {
  const time = Date.parse(row?.verified_at || '');
  return !!row && hasReliableLocationEvidence(row) && isLocationApproved(row.detected_country,row.detected_state) && row.user_id === userId && row.provider === 'MaxMind' &&
    row.verification_result === 'approved' && row.pre_bypass_verification_result === 'approved' &&
    row.geolocation_enforcement_enabled === true && row.enforcement_bypassed === false &&
    row.vpn_or_proxy_detected === false && !!row.ip_address &&
    row.detected_country === 'US' && !!row.detected_state &&
    Number.isFinite(time) && time <= Date.now() &&
    (row.trigger_event === 'wallet_onboarding' || time <= Date.parse(LEGACY_CUTOFF));
}
function publicStatus(row) {
  const approved = row?.verification_result === 'approved';
  const blocked = row?.verification_result === 'blocked';
  return {
    allowed: approved, status: row?.verification_result || 'not_started',
    verifiedAt: approved ? row.verified_at : null,
    promptEligible: blocked,
    reason: approved || !row ? '' : blocked
      ? 'Wallet setup is not available from your location. Identity verification cannot continue.'
      : row.vpn_or_proxy_detected === true
        ? 'A VPN, proxy, or anonymous network was detected. Turn it off and check your location again.'
        : row.geo_mismatch_flag === true
          ? 'Your location signals disagree. Try a different Wi-Fi or mobile connection, or contact support.'
          : 'Your network did not provide a reliable location. Try a different Wi-Fi or mobile connection, or contact support.',
  };
}
export async function walletOnboardingLocation(base44, userId) {
  if (!userId) return publicStatus(null);
  const logs = base44.asServiceRole.entities.JurisdictionVerificationLog;
  const approved = await logs.filter({
    user_id: userId, verification_result: 'approved', provider: 'MaxMind',
    pre_bypass_verification_result: 'approved', geolocation_enforcement_enabled: true,
    enforcement_bypassed: false, vpn_or_proxy_detected: false,
    $or: [{trigger_event: 'wallet_onboarding'}, {verified_at: {$lte: LEGACY_CUTOFF}}],
  }, '-verified_at', 100);
  const evidence = approved.find(row => isWalletLocationEvidence(row, userId));
  if (evidence) return publicStatus(evidence);
  const recent = await logs.filter({user_id: userId, trigger_event: 'wallet_onboarding'}, '-verified_at', 1);
  // An invalid approval is never represented as approved.
  const last = recent[0];
  if (last?.user_id === userId && last.verification_result === 'approved')
    return {allowed:false,status:'verification_failed',verifiedAt:null,promptEligible:false,
      reason:'Your previous location check did not meet our verification requirements. Try a different Wi-Fi or mobile connection, or contact support.'};
  return publicStatus(last && last.user_id === userId ? last : null);
}
