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
  return !error?.withdrawalIndeterminate && DEFINITE_DESTINATION_REASONS.has(reason);
}

// Only primitive identifiers are accepted; objects are not evidence of identity.
const primitive = value => ['string', 'number'].includes(typeof value) ? String(value).trim() : '';
const sourceIdOf = row => primitive(row?.source_id) || primitive(row?.id);
const statusOf = row => primitive(row?.status).toLowerCase().replace(/[\s-]+/g, '_');

function exactDestination(rows, owner, sourceId, local = false) {
  if (!Array.isArray(rows) || rows.some(row => !row || !primitive(row.user_id) ||
      !(local ? primitive(row.source_id) : sourceIdOf(row)))) fail('withdrawal_sources_unavailable', true);
  const exact = rows.filter(row => primitive(row.user_id) === owner &&
    (primitive(row.source_id) === sourceId || (!local && primitive(row.id) === sourceId)));
  if (exact.length === 0) fail(local ? 'withdrawal_sources_unavailable' : 'withdrawal_destination_missing', local);
  if (exact.length > 1) fail('withdrawal_destination_multiple_primary'); // legacy code: conflicting exact-source records
  const row = exact[0];
  if (!local && primitive(row.source_id) && primitive(row.id) && primitive(row.source_id) !== primitive(row.id)) {
    fail('withdrawal_destination_changed'); // conflicting provider identifiers, never a primary-bank change
  }
  const status = statusOf(row);
  if (status === 'deleted') fail('withdrawal_destination_deleted');
  if (status === 'verification_expired' || /login|reconnect/.test(status)) fail('withdrawal_destination_reconnect_required');
  if (!['verified', 'unverified', 'pending_verification', 'added'].includes(status)) fail('withdrawal_sources_unavailable', true);
  return row;
}

// The account field is the SENDER. Validate the immutable destination, not
// today's primary. Base44 positional filter() returns an array, not a page.
// Local evidence and provider evidence must both identify the same exact source.
export async function buildVerifiedWithdrawalBody(input) {
  const providerUserId = primitive(input.providerUserId), sourceId = primitive(input.sourceId);
  if (!providerUserId || !sourceId) fail('withdrawal_sources_unavailable', true);
  let localDestination;
  if (input.base44) {
    const userId = primitive(input.userId);
    if (!userId) fail('withdrawal_sources_unavailable', true);
    const rows = await input.base44.asServiceRole.entities.SeamlessBankAccount.filter(
      { user_id: userId, source_id: sourceId }, '-created_date', 2
    );
    localDestination = exactDestination(rows, userId, sourceId, true);
    if (localDestination.provider_user_id && primitive(localDestination.provider_user_id) !== providerUserId) {
      fail('withdrawal_sources_unavailable', true);
    }
  }
  const account = await seamlessRequest('GET', PATH_ACCOUNT);
  const merchantId = primitive(account?.user_id || account?.account?.user_id || account?.data?.user_id ||
    account?.data?.account?.user_id || account?.user?.user_id || account?.id);
  if (!merchantId) fail('withdrawal_account_unavailable', true);
  if (merchantId === providerUserId) fail('withdrawal_merchant_unavailable');
  const fetchSources = async id => {
    const response = await seamlessRequest('GET', '/funding-source/user/:' + encodeURIComponent(id));
    if (response?.success !== true || !Array.isArray(response.list)) fail('withdrawal_sources_unavailable', true);
    return response.list;
  };
  const [merchant, recipient] = await Promise.all([fetchSources(merchantId), fetchSources(providerUserId)]);
  // A successful list that omits an exact locally-present source is conflicting
  // evidence, not proof it was removed. Preserve the reservation for review.
  if (localDestination && !recipient.some(row => primitive(row?.user_id) === providerUserId &&
      (primitive(row?.source_id) === sourceId || primitive(row?.id) === sourceId))) {
    fail('withdrawal_sources_unavailable', true);
  }
  exactDestination(recipient, providerUserId, sourceId);
  const balances = merchant.filter(row => primitive(row?.user_id) === merchantId &&
    primitive(row?.bank).toLowerCase() === 'balance' && statusOf(row) === 'verified' && sourceIdOf(row));
  if (balances.length !== 1) fail('withdrawal_merchant_balance_unavailable');
  return buildWithdrawalBody({ ...input, providerUserId, sourceId, senderSourceId: sourceIdOf(balances[0]) });
}