// Interim ChessBet platform policy approved 2026-09-10.
// These values are product restrictions, NOT state-law clearance or statutory ages.
export const STATE_MINIMUM_AGES = Object.freeze({ AR:21, CO:21, GA:21, IA:21, KS:21, ND:21, TX:21, VA:21, WI:21, WY:21 });
export const PLATFORM_MINIMUM_AGE = 21;
export function minimumAgeForState(state) { return STATE_MINIMUM_AGES[state] ?? null; }
export function meetsStateAge(user, state) {
  const minimum = minimumAgeForState(state);
  return minimum !== null && user?.identity_age_verified === true &&
    (minimum >= 21 ? user.identity_age_over_21 === true : user.identity_age_over_18 === true);
}
