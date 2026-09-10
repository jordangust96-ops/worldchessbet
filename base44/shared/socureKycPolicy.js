// Pure provider-evidence parser. No user-entered DOB or browser callback can pass KYC.
export const POLICY_VERSION = 'socure-kyc-age-v1';
export function ageOn(dob, now = new Date()) {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== dob || d > now) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
  return age >= 0 && age <= 120 ? age : null;
}
export function verifiedBirthDate(data) {
  const dates = [];
  for (const e of Array.isArray(data?.data_enrichments) ? data.data_enrichments : []) {
    if (e.status_code !== 200 || !/socure/i.test(e.enrichment_provider || '')) continue;
    const doc = e.response?.documentVerification;
    if (doc?.decision?.value === 'accept' && doc.documentData?.dob) dates.push(doc.documentData.dob);
    for (const k of ['kyc', 'kycPlus']) {
      const result = e.response?.[k];
      if (result?.fieldValidations?.dob !== 0.99 ||
          result?.fieldValidations?.firstName !== 0.99 ||
          result?.fieldValidations?.surName !== 0.99) continue;
      const dob = e.request?.dob || e.request?.date_of_birth || result.bestMatchedEntity?.dob;
      if (dob) dates.push(dob);
    }
  }
  const unique = [...new Set(dates)];
  return unique.length === 1 && ageOn(unique[0]) !== null ? unique[0] : null;
}
export function classifyKyc(data, now = new Date()) {
  if (data?.workflow !== 'consumer_onboarding' || data?.environment_name !== 'Production')
    return { status: 'review_required', age_verified: false, failure_code: 'workflow_or_environment_mismatch' };
  if (data.eval_status !== 'evaluation_completed')
    return { status: 'pending', age_verified: false, failure_code: '' };
  if (data.decision === 'REJECT') return { status: 'rejected', age_verified: false, failure_code: 'identity_not_verified' };
  if (data.decision !== 'ACCEPT') return { status: 'review_required', age_verified: false, failure_code: 'identity_review_required' };
  const dob = verifiedBirthDate(data);
  const age = ageOn(dob, now);
  if (age === null) return { status: 'review_required', age_verified: false, failure_code: 'verified_age_evidence_missing' };
  if (age < 21) return { status: 'rejected', age_verified: true, age_over_18: age >= 18, age_over_21: false, failure_code: 'minimum_age_not_met' };
  return { status: 'verified', age_verified: true, age_over_18: true, age_over_21: age >= 21,
    failure_code: '', verified_dob: dob };
}
