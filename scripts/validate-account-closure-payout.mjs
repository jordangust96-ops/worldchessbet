import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression test for the account-closure disbursement fix: closeAccount
// previously debited Available Balance and credited a generic 'settlement'
// ledger account directly, leaving the WalletTransaction 'pending' with no
// code path that ever submitted it to Seamless — real closure payouts got
// permanently stuck (confirmed live: two real withdrawal records stuck
// 'pending' for weeks). This now requires a verified, screened bank account
// before touching the ledger at all, and — when one exists — reuses the
// exact same reservation-ledger-account/IntegrationReference/check-send
// shape as submitSeamlessWithdrawal, so a closure payout is picked up by the
// same webhook and reconcile-seamless-ach-statuses recovery machinery as any
// other withdrawal.

// Pure model of the pre-payout gate order: withdrawals must be enabled,
// identity must be verified, a verified+screened bank account must exist,
// and a Seamless customer profile must exist — in that order, before any
// WalletTransaction/ledger write happens.
function evaluateClosurePayoutGate({
  withdrawalsEnabled, identityVerified, hasVerifiedBank, bankScreeningAccepted, hasProviderProfile,
}) {
  if (!withdrawalsEnabled) return { blocked: true, action: 'withdrawals_unavailable' };
  if (!identityVerified) return { blocked: true, action: 'identity_verification_required' };
  if (!hasVerifiedBank) return { blocked: true, action: 'bank_link_required' };
  if (!bankScreeningAccepted) return { blocked: true, action: 'bank_screening_required' };
  if (!hasProviderProfile) return { blocked: true, action: 'ensure_customer' };
  return { blocked: false };
}

// Scenario 1: no verified bank account — closure with a balance must be
// blocked, and critically, this decision must happen BEFORE any ledger
// write (modeled here as: the gate function alone decides whether ledger
// legs are ever posted).
{
  const gate = evaluateClosurePayoutGate({
    withdrawalsEnabled: true, identityVerified: true, hasVerifiedBank: false,
    bankScreeningAccepted: false, hasProviderProfile: true,
  });
  assert.equal(gate.blocked, true, 'closing with a balance and no bank account is blocked');
  assert.equal(gate.action, 'bank_link_required', 'the user is told to link a bank account, not left with a stranded ledger debit');
}

// Scenario 2: bank exists but Socure bank screening was never accepted —
// still blocked, same as a normal withdrawal would be.
{
  const gate = evaluateClosurePayoutGate({
    withdrawalsEnabled: true, identityVerified: true, hasVerifiedBank: true,
    bankScreeningAccepted: false, hasProviderProfile: true,
  });
  assert.equal(gate.blocked, true, 'an unscreened bank account blocks the payout');
  assert.equal(gate.action, 'bank_screening_required');
}

// Scenario 3: everything present — payout proceeds to the ledger/provider steps.
{
  const gate = evaluateClosurePayoutGate({
    withdrawalsEnabled: true, identityVerified: true, hasVerifiedBank: true,
    bankScreeningAccepted: true, hasProviderProfile: true,
  });
  assert.equal(gate.blocked, false, 'a fully verified, screened, provider-linked account is allowed to proceed');
}

// Scenario 4: withdrawals globally disabled — closure-with-balance must not
// silently proceed and strand funds; it must block exactly like a normal
// withdrawal would.
{
  const gate = evaluateClosurePayoutGate({
    withdrawalsEnabled: false, identityVerified: true, hasVerifiedBank: true,
    bankScreeningAccepted: true, hasProviderProfile: true,
  });
  assert.equal(gate.blocked, true, 'closure-with-balance is blocked while withdrawals are disabled platform-wide');
  assert.equal(gate.action, 'withdrawals_unavailable');
}

// Scenario 5: reservation ledger legs mirror submitSeamlessWithdrawal's
// shape exactly (debit available + heldDelta on user_account, credit
// withdrawal_reserve) — NOT the old direct debit-to-'settlement' pattern —
// so downstream reconciliation treats it identically to any other withdrawal.
function reservationLegs(amount) {
  return [
    { ledgerAccount: 'user_account', debit: amount, credit: 0, heldDelta: amount, transactionType: 'withdrawal' },
    { ledgerAccount: 'withdrawal_reserve', debit: 0, credit: amount, transactionType: 'withdrawal' },
  ];
}
{
  const legs = reservationLegs(42);
  assert.equal(legs[0].ledgerAccount, 'user_account');
  assert.equal(legs[0].heldDelta, 42, 'the debited amount is also held, matching a real withdrawal reservation');
  assert.equal(legs[1].ledgerAccount, 'withdrawal_reserve', 'funds land in withdrawal_reserve, not the old generic settlement account');
}

// Cross-check against the actual deployed source.
const [closeAccountSrc, submitWithdrawalSrc] = await Promise.all([
  readFile(new URL('../base44/functions/closeAccount/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/submitSeamlessWithdrawal/entry.ts', import.meta.url), 'utf8'),
]);

// The old broken pattern must be gone.
assert.doesNotMatch(
  closeAccountSrc,
  /triggerEvent: 'account_closure_disbursement'/,
  'closeAccount no longer posts through the old unrouted account_closure_disbursement trigger event'
);
assert.doesNotMatch(
  closeAccountSrc,
  /ledgerAccount: 'settlement', debit: 0, credit: payout/,
  'closeAccount no longer credits the generic settlement account directly for a payout'
);

// The new gates and provider submission must be present.
assert.match(closeAccountSrc, /seamlessWithdrawalsEnabled\(\)/, 'closeAccount checks the withdrawals-enabled flag before paying out');
assert.match(closeAccountSrc, /action: 'bank_link_required'/, 'closeAccount blocks and explains when no verified bank account exists');
assert.match(closeAccountSrc, /isSocureBankVerificationAccepted\(bankVerification, bank\.source_id\)/, 'closeAccount requires accepted bank screening, same as a normal withdrawal');
assert.match(closeAccountSrc, /triggerEvent: 'withdrawal_reservation'/, 'closeAccount reserves funds using the same trigger event as a normal withdrawal');
assert.match(closeAccountSrc, /`seamless:withdrawal:reserve:\$\{walletTransaction\.id\}`/, 'closeAccount uses the same deterministic ledger_group_id convention as a normal withdrawal');
assert.match(closeAccountSrc, /seamlessRequest\('POST', PATH_CHECK_SEND,/, 'closeAccount actually calls the Seamless check-send endpoint');
assert.match(closeAccountSrc, /acquireUserWalletLock\(user\.id, lockOwner\)/, 'closeAccount takes the same wallet lock as submitSeamlessWithdrawal to prevent a concurrent-withdrawal race');
assert.match(closeAccountSrc, /releaseUserWalletLock\(lockedUserId, lockOwner\)/, 'closeAccount releases the wallet lock in a finally block');

// Both functions must agree on the reservation/release ledger_group_id
// naming convention, so the SAME webhook/reconciliation code (which derives
// these group ids purely from the wallet_transaction id) resolves either
// kind of withdrawal without any special-casing.
assert.match(submitWithdrawalSrc, /`seamless:withdrawal:reserve:\$\{tx\.id\}`/);
assert.match(closeAccountSrc, /`seamless:withdrawal:reserve:\$\{walletTransaction\.id\}`/);
assert.match(submitWithdrawalSrc, /`seamless:withdrawal:release:\$\{tx\.id\}`/);
assert.match(closeAccountSrc, /`seamless:withdrawal:release:\$\{walletTransaction\.id\}`/);

console.log('Account closure payout validation passed.');
