import { seamlessRequest, PATH_ACCOUNT, buildWithdrawalBody } from './seamlessAch.ts';

// Seamless Direct Credit: POST /ach/v2/check/send. The `account` field is the
// SENDER (merchant) Seamless Balance source — never the recipient bank. An
// unverified funding source CAN receive credits/direct deposits; verification
// is required only for debits. Therefore recipient status !== verified must
// not by itself reject a withdrawal.

// Definitive pre-submission destination outcomes. Each is a persisted, precise
// reason the withdrawal cannot proceed — never a transient provider read. The
// handler releases the reservation for these with correct, distinct messaging.
export const DEFINITE_DESTINATION_REASONS = new Set([
  'withdrawal_destination_changed',
  'withdrawal_destination_missing',
  'withdrawal_destination_multiple_primary',
  'withdrawal_destination_deleted',
  'withdrawal_destination_reconnect_required',
  'withdrawal_merchant_unavailable',
  'withdrawal_merchant_balance_unavailable',
]);

function fail(code, indeterminate = false) {
  throw Object.assign(new Error(code), {
    status: indeterminate ? 503 : 409,
    withdrawalReason: code,
    withdrawalIndeterminate: indeterminate,
  });
}

// Returns true when an error from buildVerifiedWithdrawalBody is a definitive
// pre-submission rejection (safe to release funds) vs an indeterminate
// provider read (funds must stay reserved).
export function isDefinitePreflightRejection(error) {
  const reason = String(error?.withdrawalReason || '');
  return DEFINITE_DESTINATION_REASONS.has(reason);
}

// The API's account field is the SENDER. Recipient's linked primary bank is
// selected by recipient ID; verify it still matches the request's saved bank.
// Precise, persisted outcomes replace the coarse withdrawal_destination_changed
// preflight: destination changed, missing, multiple-primary, deleted,
// reconnect-required (login-required / verification-expired), merchant issues.
// Indeterminate provider reads (ambiguous response, timeout, 5xx) never reject.
export async function buildVerifiedWithdrawalBody(input) {
  const account = await seamlessRequest('GET', PATH_ACCOUNT);
  const merchantId = account?.user_id || account?.account?.user_id || account?.data?.user_id ||
    account?.data?.account?.user_id || account?.user?.user_id || account?.id;
  if (!merchantId || merchantId === input.providerUserId) fail('withdrawal_merchant_unavailable');

  const fetchSources = async (id) => {
    const response = await seamlessRequest('GET', '/funding-source/user/:' + encodeURIComponent(id));
    // An ambiguous/non-success response is indeterminate, never a definitive
    // rejection: a transient provider read must never release funds.
    if (response?.success !== true || !Array.isArray(response.list)) fail('withdrawal_sources_unavailable', true);
    return response.list;
  };

  const [merchant, recipient] = await Promise.all([fetchSources(merchantId), fetchSources(input.providerUserId)]);

  // Confirm exactly one current primary destination that belongs to the
  // recipient and whose source_id equals the immutable snapshot saved on the
  // withdrawal. Do not require verified merely to receive a credit.
  const primary = recipient.filter(row => row.is_primary === true && row.user_id === input.providerUserId);
  if (primary.length === 0) fail('withdrawal_destination_missing');
  if (primary.length > 1) fail('withdrawal_destination_multiple_primary');
  if (primary[0].source_id !== input.sourceId) fail('withdrawal_destination_changed');
  const status = String(primary[0].status || '').toLowerCase();
  if (status === 'deleted') fail('withdrawal_destination_deleted');
  // login-required / verification-expired are a distinct hold/review state
  // (the bank needs reconnection), not a destination change.
  if (status === 'verification_expired' || status === 'login_required' || /login|reconnect/.test(status)) {
    fail('withdrawal_destination_reconnect_required');
  }
  // Unverified, pending_verification, added, verified — all credit-eligible.

  const balances = merchant.filter(row => row.user_id === merchantId &&
    String(row.bank).toLowerCase() === 'balance' && String(row.status).toLowerCase() === 'verified' && row.source_id);
  if (balances.length !== 1) fail('withdrawal_merchant_balance_unavailable');
  return buildWithdrawalBody({ ...input, senderSourceId: balances[0].source_id });
}