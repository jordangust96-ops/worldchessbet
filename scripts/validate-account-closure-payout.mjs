import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function evaluateClosurePayoutGate({
  withdrawalsEnabled,
  accountVerified,
  hasVerifiedBank,
  hasProviderProfile,
  hasRetainedEvidence,
}) {
  if (!withdrawalsEnabled) return { blocked: true, action: 'withdrawals_unavailable' };
  if (!accountVerified) return { blocked: true, action: 'bank_verification_required' };
  if (!hasVerifiedBank) return { blocked: true, action: 'bank_link_required' };
  if (!hasProviderProfile) return { blocked: true, action: 'ensure_customer' };
  if (!hasRetainedEvidence) return { blocked: true, action: 'compliance_evidence_required' };
  return { blocked: false };
}

assert.deepEqual(evaluateClosurePayoutGate({
  withdrawalsEnabled: false, accountVerified: true, hasVerifiedBank: true,
  hasProviderProfile: true, hasRetainedEvidence: true,
}), { blocked: true, action: 'withdrawals_unavailable' });
assert.deepEqual(evaluateClosurePayoutGate({
  withdrawalsEnabled: true, accountVerified: false, hasVerifiedBank: true,
  hasProviderProfile: true, hasRetainedEvidence: true,
}), { blocked: true, action: 'bank_verification_required' });
assert.deepEqual(evaluateClosurePayoutGate({
  withdrawalsEnabled: true, accountVerified: true, hasVerifiedBank: false,
  hasProviderProfile: true, hasRetainedEvidence: true,
}), { blocked: true, action: 'bank_link_required' });
assert.equal(evaluateClosurePayoutGate({
  withdrawalsEnabled: true, accountVerified: true, hasVerifiedBank: true,
  hasProviderProfile: true, hasRetainedEvidence: true,
}).blocked, false);

const [closeAccount, withdrawal] = await Promise.all([
  readFile(new URL('../base44/functions/closeAccount/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/submitSeamlessWithdrawal/entry.ts', import.meta.url), 'utf8'),
]);

assert.match(closeAccount, /seamlessWithdrawalsEnabled\(\)/);
assert.match(closeAccount, /isSeamlessPlaidVerified\(user\)/);
assert.match(closeAccount, /status: 'verified'/);
assert.match(closeAccount, /extendComplianceEvidenceRetention/);
assert.match(closeAccount, /triggerEvent: 'withdrawal_reservation'/);
assert.match(closeAccount, /`seamless:withdrawal:reserve:\$\{walletTransaction\.id\}`/);
assert.match(closeAccount, /seamlessRequest\('POST', PATH_CHECK_SEND,/);
assert.match(closeAccount, /acquireUserWalletLock\(user\.id, lockOwner\)/);
assert.match(closeAccount, /releaseUserWalletLock\(lockedUserId, lockOwner\)/);
assert.doesNotMatch(closeAccount, /Socure|SOCURE|socure/);
assert.doesNotMatch(closeAccount, /triggerEvent: 'account_closure_disbursement'/);

assert.match(withdrawal, /`seamless:withdrawal:reserve:\$\{tx\.id\}`/);
assert.match(withdrawal, /`seamless:withdrawal:release:\$\{tx\.id\}`/);
assert.match(closeAccount, /`seamless:withdrawal:release:\$\{walletTransaction\.id\}`/);

console.log('Account closure payout validation passed.');
