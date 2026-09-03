// Shared, dependency-free ACH authorization contract. This draft must be
// approved by Seamless compliance before SEAMLESS_THIRD_PARTY_FUNDING_ENABLED
// is set to true.
export const ACH_AUTHORIZATION_VERSION = 'draft-2026-09-03-v2';

export const ACH_AUTHORIZATION_TEXT =
  'By checking the box and entering my legal name, I authorize ChessBet and its payment processor, SeamlessChex, to initiate electronic ACH debits from and credits to the checking or savings account I provide. This standing authorization applies only to transfers I separately request through my ChessBet Wallet; the amount and expected processing date of each debit will be displayed before I submit it. I certify that I am authorized to use this account and that the bank information is correct. I may revoke this authorization for future transfers by contacting hello@worldchessbet.com before a transfer is submitted; revocation does not affect entries already initiated. I can retain a copy of this authorization for my records.';

export function normalizeBankDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function complianceRetentionUntil(activityAt = new Date().toISOString()) {
  const date = new Date(activityAt);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid compliance activity timestamp');
  date.setUTCFullYear(date.getUTCFullYear() + 2);
  return date.toISOString();
}

export function requestIpAddress(req) {
  const forwarded = String(req?.headers?.get?.('x-forwarded-for') || '').split(',')[0].trim();
  return String(
    req?.headers?.get?.('cf-connecting-ip') ||
    req?.headers?.get?.('x-real-ip') ||
    forwarded ||
    ''
  ).slice(0, 128);
}
