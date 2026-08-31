// Pure, runtime-agnostic Seamless ACH v2 helpers. NO Deno.env, NO Node APIs.
// Shared by the Deno backend client (base44/shared/seamlessAch.ts) and the
// deterministic Node test (scripts/validate-seamless.mjs). Keep dependency-free
// so it imports unchanged in both runtimes.

export const SEAMLESS_PROVIDER_KEY = 'seamless_ach';

export const STATUS_COMPLETED = 'completed';
export const STATUS_PENDING = 'pending';
export const STATUS_FAILED = 'failed';
export const STATUS_REVERSED = 'reversed';

// Seamless ACH v2 endpoint paths.
export const PATH_CREATE_CUSTOMER = '/user';
export const PATH_ACH_DEBIT = '/ach-debit';
export const PATH_CHECK_SEND = '/check/send';

// Amounts are sent to Seamless as fixed 2-decimal strings.
export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid amount');
  return n.toFixed(2);
}

// Map raw Seamless transaction statuses to ChessBet WalletTransaction lifecycle.
// ONLY "Processed" is treated as settled. Unknown statuses default to pending
// (never settled) so the ledger is never credited on an ambiguous signal.
export function mapTransactionStatus(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'processed') return STATUS_COMPLETED;
  if (s === 'pending' || s === 'processing' || s === 'hold' || s === 'refund_pending') return STATUS_PENDING;
  if (
    s === 'failed' || s === 'declined' || s === 'voided' || s === 'unpaid' ||
    s === 'expired' || s === 'refund_failed'
  ) return STATUS_FAILED;
  if (s === 'refunded') return STATUS_REVERSED;
  return STATUS_PENDING;
}

export function seamlessBaseUrl(env) {
  if (env === 'production') return 'https://api.seamlesschex.com/ach/v2';
  if (env === 'sandbox') return 'https://sandbox.seamlesschex.com/ach/v2';
  throw new Error('SEAMLESS_ACH_ENV must be "sandbox" or "production"');
}

export function seamlessDashboardHost(env) {
  if (env === 'production') return 'https://dashboard.seamlesschex.com';
  if (env === 'sandbox') return 'https://sandbox.seamlesschex.com';
  throw new Error('SEAMLESS_ACH_ENV must be "sandbox" or "production"');
}

// Hosted Plaid-style bank authorization URL (NOT direct Plaid Link).
// production: https://dashboard.seamlesschex.com/ach/#/bank-account/{PUBLIC_KEY}/{USER_ID}?successUrl=..&cancelUrl=..
// sandbox:     https://sandbox.seamlesschex.com/ach/#/bank-account/...
export function buildBankLinkUrl({ env, publicKey, providerUserId, successUrl, cancelUrl }) {
  if (!publicKey) throw new Error('SEAMLESS_ACH_PUBLIC_KEY required');
  if (!providerUserId) throw new Error('provider user id required');
  const host = seamlessDashboardHost(env);
  const base = `${host}/ach/#/bank-account/${encodeURIComponent(publicKey)}/${encodeURIComponent(providerUserId)}`;
  const params = new URLSearchParams();
  if (successUrl) params.set('successUrl', successUrl);
  if (cancelUrl) params.set('cancelUrl', cancelUrl);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function buildCreateCustomerBody({ firstName, lastName, email, phone }) {
  if (!firstName || !lastName) throw new Error('firstName and lastName required');
  const body = { firstName, lastName };
  if (email) body.email = email;
  if (phone) body.phone = phone;
  return body;
}

// Deposit: POST /ach-debit with sender = provider user id.
export function buildDepositBody({ providerUserId, name, amount, description, label }) {
  if (!providerUserId) throw new Error('provider user id required');
  if (!String(name || '').trim()) throw new Error('account holder name required');
  if (!label) throw new Error('stable label required');
  return {
    sender: providerUserId,
    name: String(name).trim(),
    amount: formatAmount(amount),
    description: description || 'Fund wallet',
    label,
  };
}

// Withdrawal: POST /check/send with recipient = provider user id, account = verified source_id.
export function buildWithdrawalBody({ providerUserId, name, amount, description, label, sourceId }) {
  if (!providerUserId) throw new Error('provider user id required');
  if (!String(name || '').trim()) throw new Error('account holder name required');
  if (!sourceId) throw new Error('verified source_id required');
  if (!label) throw new Error('stable label required');
  return {
    recipient: providerUserId,
    name: String(name).trim(),
    amount: formatAmount(amount),
    description: description || 'Withdrawal',
    label,
    account: sourceId,
  };
}

// Constant-time string equality for secret comparison. Never leaks length via
// an early return; always iterates over the longer of the two inputs.
export function constantTimeEqual(a, b) {
  const sa = String(a == null ? '' : a);
  const sb = String(b == null ? '' : b);
  const max = Math.max(sa.length, sb.length);
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < max; i++) {
    const ca = i < sa.length ? sa.charCodeAt(i) : 0;
    const cb = i < sb.length ? sb.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

// Stable webhook idempotency key. Uses the provider event_id when present;
// otherwise a stable FNV-1a hash of (provider ref + event type + status + ts).
export function webhookIdempotencyKey({ eventId, providerRef, eventType, status, timestamp }) {
  if (eventId) return `seamless:${eventId}`;
  const raw = `${providerRef || ''}|${eventType || ''}|${status || ''}|${timestamp || ''}`;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `seamless:${h.toString(16)}`;
}

// Pure decision reducer for transaction.status webhooks. Returns the intended
// action and the next WalletTransaction status WITHOUT touching the DB. The
// real webhook handler re-verifies current state before enacting, so this is
// the deterministic, testable core of the money-state machine.
//
// Actions:
//   'ignore'  -> no ledger change (pending, or already in that terminal state)
//   'post'    -> first Processed: post the balanced settlement ledger exactly once
//   'fail'    -> failure while still pending: mark failed (no balance change)
//   'reverse' -> failure/refund AFTER settlement: reverse the prior posting
export function applyWebhookEvent(current, event) {
  const mapped = mapTransactionStatus(event?.status);
  const curStatus = current?.status || STATUS_PENDING;
  const alreadyCompleted = curStatus === STATUS_COMPLETED;
  const alreadyTerminalBad = curStatus === STATUS_FAILED || curStatus === STATUS_REVERSED;

  if (mapped === STATUS_PENDING) return { action: 'ignore', status: curStatus };

  if (mapped === STATUS_COMPLETED) {
    if (alreadyCompleted) return { action: 'ignore', status: STATUS_COMPLETED }; // exactly-once
    if (alreadyTerminalBad) return { action: 'ignore', status: curStatus }; // stale/out-of-order
    return { action: 'post', status: STATUS_COMPLETED };
  }

  if (mapped === STATUS_FAILED) {
    if (alreadyCompleted) return { action: 'reverse', status: STATUS_REVERSED };
    if (alreadyTerminalBad) return { action: 'ignore', status: curStatus };
    return { action: 'fail', status: STATUS_FAILED };
  }

  if (mapped === STATUS_REVERSED) {
    if (curStatus === STATUS_REVERSED) return { action: 'ignore', status: STATUS_REVERSED };
    if (alreadyCompleted) return { action: 'reverse', status: STATUS_REVERSED };
    return { action: 'fail', status: STATUS_REVERSED };
  }

  return { action: 'ignore', status: curStatus };
}