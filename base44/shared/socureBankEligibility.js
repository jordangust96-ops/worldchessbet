export const SOCURE_BANK_ACCEPTED_STATUS = 'completed';

export function isSocureBankVerificationAccepted(verification, sourceId = '') {
  if (!verification || verification.status !== SOCURE_BANK_ACCEPTED_STATUS) return false;
  if (verification.decision !== 'ACCEPT') return false;
  if (sourceId && verification.source_id !== sourceId) return false;
  return true;
}

export function latestSocureBankVerification(verifications, sourceId) {
  return (Array.isArray(verifications) ? verifications : [])
    .filter((item) => item?.source_id === sourceId)
    .sort((a, b) =>
      new Date(b?.requested_at || b?.created_date || 0).getTime()
      - new Date(a?.requested_at || a?.created_date || 0).getTime()
      || String(b?.id || '').localeCompare(String(a?.id || ''))
    )[0] || null;
}

export function publicSocureBankStatus(verification) {
  if (!verification) return 'not_started';
  if (isSocureBankVerificationAccepted(verification)) return 'verified';
  if (verification.status === 'processing') return 'processing';
  if (verification.status === 'manual_review_required') return 'review_required';
  if (verification.status === 'unknown_outcome') return 'review_required';
  return 'failed';
}
