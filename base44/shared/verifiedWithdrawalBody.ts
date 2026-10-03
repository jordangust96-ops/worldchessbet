import { buildWithdrawalBody } from './seamlessAch.ts';

// Seamless Direct Credit: POST /ach/v2/check/send. The official Online Gaming
// Guide and Direct Credit reference require only a customer profile and a
// connected funding source before the credit. There is NO documented
// requirement to list a recipient's funding sources before the POST, so this
// builder performs ZERO provider GETs: it validates only ChessBet's locally
// persisted frozen destination and customer mapping, then builds the body.
//
// An unverified funding source CAN receive credits/direct deposits; verification
// is required only for debits. Therefore recipient status !== verified must
// not by itself reject a withdrawal unless it is a definitive unavailable state.

// Definitive pre-submission destination outcomes. Each is a persisted, precise
// reason the withdrawal cannot proceed — never a transient provider read. The
// handler releases the reservation for these with correct, distinct messaging.
export const DEFINITE_DESTINATION_REASONS = new Set([
  'withdrawal_destination_changed',
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
// pre-submission rejection (safe to release funds) vs an indeterminate local
// read (funds must stay reserved).
export function isDefinitePreflightRejection(error) {
  const reason = String(error?.withdrawalReason || '');
  return !error?.withdrawalIndeterminate && DEFINITE_DESTINATION_REASONS.has(reason);
}

// Only primitive identifiers are accepted; objects are not evidence of identity.
const primitive = value => ['string', 'number'].includes(typeof value) ? String(value).trim() : '';
const statusOf = row => primitive(row?.status).toLowerCase().replace(/[\s-]+/g, '_');

// Credit-eligible destination statuses per Seamless's Direct Credit contract:
// verification is required for debits, not credits. An added, pending-verification,
// or verified funding source may all receive a direct credit. 'unverified' covers
// the legacy provider label for credit-only sources.
const CREDIT_ELIGIBLE_STATUSES = new Set(['added', 'pending_verification', 'verified', 'unverified']);

// Validate the locally persisted frozen destination by exact user + source_id.
// No provider funding-source list GET. Returns the matched local record or
// throws a definitive/indeterminate withdrawal reason.
function exactLocalDestination(rows, owner, sourceId) {
  if (!Array.isArray(rows)) fail('withdrawal_sources_unavailable', true);
  const exact = rows.filter(row => primitive(row?.source_id) === sourceId);
  if (exact.length > 1) fail('withdrawal_destination_multiple_primary');
  // A missing local destination (no exact source_id match, or owner mismatch) is
  // indeterminate, not definitive: the frozen record may be absent due to a local
  // sync/read issue rather than a confirmed invalid destination, so funds stay
  // reserved for reconciliation instead of being auto-released.
  if (exact.length === 0 || primitive(exact[0].user_id) !== owner) {
    fail('withdrawal_destination_missing', true);
  }
  const row = exact[0];
  const status = statusOf(row);
  if (status === 'deleted') fail('withdrawal_destination_deleted');
  if (status === 'login_required') fail('withdrawal_destination_reconnect_required');
  if (status === 'error') fail('withdrawal_destination_reconnect_required');
  if (status === 'verification_failed') fail('withdrawal_destination_reconnect_required');
  if (status === 'verification_expired') fail('withdrawal_destination_reconnect_required');
  if (!CREDIT_ELIGIBLE_STATUSES.has(status)) fail('withdrawal_sources_unavailable', true);
  return row;
}

// Build the Direct Credit request body from the locally persisted frozen
// destination and customer mapping. No provider GET. account is included ONLY
// when an explicit merchant sender source id is configured; the recipient
// funding_source_id is never sent as account or as a body field.
export async function buildVerifiedWithdrawalBody(input) {
  const providerUserId = primitive(input.providerUserId);
  const sourceId = primitive(input.sourceId);
  if (!providerUserId || !sourceId) fail('withdrawal_sources_unavailable', true);

  // Validate only ChessBet's locally persisted frozen destination and customer
  // mapping before POST /ach/v2/check/send. A transient local read failure stays
  // indeterminate so funds remain reserved until the record can be confirmed.
  if (input.base44) {
    const userId = primitive(input.userId);
    if (!userId) fail('withdrawal_sources_unavailable', true);
    let rows;
    try {
      // Query by user_id only, then match source_id in JS so primitive number/string
      // shapes from the SDK response are normalized without a cross-type DB mismatch.
      rows = await input.base44.asServiceRole.entities.SeamlessBankAccount.filter(
        { user_id: userId }, '-created_date', 10
      );
    } catch {
      fail('withdrawal_sources_unavailable', true);
    }
    const local = exactLocalDestination(rows, userId, sourceId);
    if (local && primitive(local.provider_user_id) && primitive(local.provider_user_id) !== providerUserId) {
      fail('withdrawal_sources_unavailable', true);
    }
  }

  // account is the merchant sender source_id ONLY when explicitly configured.
  // Never send the recipient funding_source_id (sourceId) as account.
  const senderSourceId = primitive(input.senderSourceId);

  return buildWithdrawalBody({
    providerUserId,
    name: input.name,
    amount: input.amount,
    description: input.description,
    label: input.label,
    sourceId,
    senderSourceId,
    transferSpeed: input.transferSpeed,
  });
}