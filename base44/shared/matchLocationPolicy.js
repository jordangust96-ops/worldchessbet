import { isReusableVerification } from './jurisdictionGates.js';
import { isLocationApproved } from './jurisdictionRegions.js';

// Same duration as the preparation window. Deposit/create/join approvals
// cannot substitute for a location check made for this match's readiness.
export const MATCH_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;
export function isMatchLocationEvidence(log, match, userId, now = Date.now()) {
  const preparedAt = Date.parse(match?.preparation_started_at);
  return Boolean(
    match?.id && [match.player1_id, match.player2_id].includes(userId) &&
    Number.isFinite(preparedAt) && preparedAt <= now &&
    log?.related_entity_type === 'match' && log.related_entity_id === match.id &&
    log.trigger_event === 'match_readiness' &&
    log.verification_result === 'approved' &&
    log.vpn_or_proxy_detected === false &&
    typeof log.ip_address === 'string' && log.ip_address.length > 0 &&
    Date.parse(log.verified_at) >= preparedAt &&
    isLocationApproved(log.detected_country, log.detected_state) &&
    isReusableVerification(log, log.ip_address, now, MATCH_LOCATION_MAX_AGE_MS, userId)
  );
}
