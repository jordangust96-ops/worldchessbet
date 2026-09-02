// Server-only Seamless ACH v2 client. Re-exports the pure helpers and adds the
// Deno.env-dependent pieces (config resolution, authenticated fetch, webhook
// auth verification). Never import this from the browser — it reads secrets.

import {
  SEAMLESS_PROVIDER_KEY,
  formatAmount,
  mapTransactionStatus,
  seamlessBaseUrl,
  seamlessDashboardHost,
  buildBankLinkUrl,
  buildCreateCustomerBody,
  buildDepositBody,
  buildWithdrawalBody,
  buildMerchantBalanceTransferBody,
  buildVerifiedThirdPartyFundingSourceBody,
  constantTimeEqual,
  webhookIdempotencyKey,
  isMerchantBalanceTransaction,
  applyWebhookEvent,
  applyFundingSourceEvent,
  normalizeProviderEventTime,
  PATH_CREATE_CUSTOMER,
  PATH_ACH_DEBIT,
  PATH_CHECK_SEND,
  PATH_BALANCE_FROM_ACCOUNT,
  PATH_BALANCE_TO_ACCOUNT,
  PATH_VERIFIED_THIRD_PARTY_FUNDING_SOURCE,
} from './seamlessAchPure.js';

export {
  SEAMLESS_PROVIDER_KEY,
  formatAmount,
  mapTransactionStatus,
  seamlessBaseUrl,
  seamlessDashboardHost,
  buildBankLinkUrl,
  buildCreateCustomerBody,
  buildDepositBody,
  buildWithdrawalBody,
  buildMerchantBalanceTransferBody,
  buildVerifiedThirdPartyFundingSourceBody,
  constantTimeEqual,
  webhookIdempotencyKey,
  isMerchantBalanceTransaction,
  applyWebhookEvent,
  applyFundingSourceEvent,
  normalizeProviderEventTime,
  PATH_CREATE_CUSTOMER,
  PATH_ACH_DEBIT,
  PATH_CHECK_SEND,
  PATH_BALANCE_FROM_ACCOUNT,
  PATH_BALANCE_TO_ACCOUNT,
  PATH_VERIFIED_THIRD_PARTY_FUNDING_SOURCE,
};

// Resolve Seamless config from server secrets. Fails closed (throws) on any
// missing or invalid value, so no provider call can ever run half-configured.
export function seamlessConfig() {
  const env = (Deno.env.get('SEAMLESS_ACH_ENV') || '').trim();
  const secret = Deno.env.get('SEAMLESS_ACH_SECRET_KEY') || '';
  const publicKey = Deno.env.get('SEAMLESS_ACH_PUBLIC_KEY') || '';
  const baseUrl = seamlessBaseUrl(env); // throws if env is not sandbox|production
  if (!secret) throw new Error('SEAMLESS_ACH_SECRET_KEY is not configured');
  return { env, secret, publicKey, baseUrl };
}

// Authenticated Seamless ACH v2 call. Server-side Bearer auth only; the secret
// is never returned, logged, or surfaced to the client.
export async function seamlessRequest(method, path, payload) {
  const { secret, baseUrl } = seamlessConfig();
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret}`,
    },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const msg = data?.message || data?.error || `Seamless ACH request failed (${response.status})`;
    const err = new Error(msg);
    err.status = response.status;
    err.providerError = data;
    throw err;
  }
  return data;
}

// Verify an incoming webhook's Authorization header against the secret.
// Accepts the exact secret as a Bearer token, or as the username OR password
// in Basic auth (per Seamless docs). Constant-time comparison. Rejects
// missing/malformed/mismatched auth. NEVER logs the header or the secret.
export function verifySeamlessWebhookAuth(authHeader) {
  const secret = Deno.env.get('SEAMLESS_ACH_SECRET_KEY') || '';
  if (!secret) return false; // fail closed when unconfigured
  const header = String(authHeader || '').trim();
  if (!header) return false;
  // Seamless's live endpoint test currently sends the secret directly in
  // Authorization (without a scheme). Support that documented provider form
  // alongside Bearer and Basic while retaining constant-time comparison.
  if (constantTimeEqual(header, secret)) return true;
  const lower = header.toLowerCase();
  try {
    if (lower.startsWith('bearer ')) {
      const token = header.slice(7).trim();
      return constantTimeEqual(token, secret);
    }
    if (lower.startsWith('basic ')) {
      const decoded = atob(header.slice(6).trim());
      const idx = decoded.indexOf(':');
      const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      return constantTimeEqual(user, secret) || constantTimeEqual(pass, secret);
    }
  } catch {
    // Malformed Basic payload — reject silently.
  }
  return false;
}