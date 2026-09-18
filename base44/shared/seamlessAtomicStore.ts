// Server-only atomic claim store for financial operations. Upstash Redis
// executes each Lua EVAL atomically, allowing independent per-user/event locks
// across Base44 function instances. No browser code imports this module.
// Named for its original Seamless deposit/withdrawal callers, but
// acquireUserWalletLock/releaseUserWalletLock key only on user id and are
// deliberately shared by any function that debits/credits a user's Wallet —
// lockWager (contest entry) included — so two money-movement paths for the
// same user, Seamless or not, always serialize against one another.
const PREFIX = 'chessbet:seamless:v1';
// One merchant-wide rolling payout budget, shared by normal and closure withdrawals.
export async function claimPayoutCapacity(transactionId: string, cents: number, history: unknown[]) {
  const { CLAIM_PAYOUT_CAPACITY } = await import('./withdrawalLimits.js');
  const env = (Deno.env.get('SEAMLESS_ACH_ENV') || '').trim();
  if (!['sandbox', 'production'].includes(env)) throw new Error('Invalid Seamless environment');
  return parse(await evalAtomic(CLAIM_PAYOUT_CAPACITY, [key('payout-capacity', env)],
    [transactionId, String(cents), JSON.stringify(history)]));
}

const OP_TTL_SECONDS = 60 * 60 * 24 * 90;
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 90;
// A lease must outlast the 12s provider timeout and the subsequent Base44
// ledger/entity writes. A crashed worker remains recoverable after three minutes.
const LOCK_TTL_MS = 3 * 60 * 1000;

function config() {
  const url = (Deno.env.get('SEAMLESS_ATOMIC_REDIS_REST_URL') || '').trim().replace(/\/$/, '');
  const token = (Deno.env.get('SEAMLESS_ATOMIC_REDIS_REST_TOKEN') || '').trim();
  if (!url || !token) throw new Error('Seamless atomic store is not configured');
  return { url, token };
}

async function command(parts: unknown[]) {
  const { url, token } = config();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(parts),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    const message = String(payload?.error || '');
    // Operational categories only: never propagate provider payloads or tokens.
    const reason = /READONLY|read.only/i.test(message) ? 'read_only'
      : /NOAUTH|NOPERM|auth|permission|token/i.test(message) ? 'authorization'
      : /quota|limit|capacity/i.test(message) ? 'capacity'
      : /script|lua|syntax|compile/i.test(message) ? 'script'
      : 'provider_error';
    throw Object.assign(new Error('Seamless atomic store unavailable'), {
      coordinationHttpStatus: response.status, coordinationReason: reason,
      coordinationCommands: ['EVAL','INCR','EXPIRE','GET','SET','TIME'].filter(name => new RegExp('\\b' + name + '\\b','i').test(message)),
      coordinationReadOnly: /READONLY|read.only/i.test(message),
    });
  }
  return payload?.result;
}

async function evalAtomic(script: string, keys: string[], args: string[]) {
  return command(['EVAL', script, String(keys.length), ...keys, ...args]);
}

function parse(value: unknown) {
  try { return JSON.parse(String(value || '')); } catch { return null; }
}

function key(kind: string, value: string) {
  return `${PREFIX}:${kind}:${value}`;
}

const ACQUIRE_LOCK = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
if current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0
`;

const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

const CLAIM_RECORD = `
local current = redis.call('GET', KEYS[1])
if current then return current end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return ARGV[1]
`;

const SET_RECORD = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return ARGV[1]
`;

const CLAIM_WEBHOOK = `
local current = redis.call('GET', KEYS[1])
if current then
  local record = cjson.decode(current)
  if record.state == 'completed' then return cjson.encode({ claim = 'completed', record = record }) end
  if record.state == 'processing' and tonumber(record.lease_until or 0) > tonumber(ARGV[2]) and record.owner ~= ARGV[1] then
    return cjson.encode({ claim = 'busy', record = record })
  end
end
local lockOwner = redis.call('GET', KEYS[2])
if lockOwner and lockOwner ~= ARGV[1] then
  return cjson.encode({ claim = 'transaction_busy' })
end
local next = { state = 'processing', owner = ARGV[1], lease_until = tonumber(ARGV[2]) + tonumber(ARGV[3]), attempts = 1 }
if current then
  local old = cjson.decode(current)
  next.attempts = tonumber(old.attempts or 0) + 1
end
redis.call('SET', KEYS[1], cjson.encode(next), 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[3])
return cjson.encode({ claim = 'owned', record = next })
`;

const FINISH_WEBHOOK = `
local current = redis.call('GET', KEYS[1])
local record = current and cjson.decode(current) or {}
record.state = ARGV[2]
record.owner = ''
record.lease_until = 0
record.updated_at = ARGV[3]
if ARGV[4] ~= '' then record.last_error = ARGV[4] end
redis.call('SET', KEYS[1], cjson.encode(record), 'EX', ARGV[5])
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return cjson.encode(record)
`;

export function atomicStoreEnabled() {
  try { config(); return true; } catch { return false; }
}

// Read-only production health probe. EVAL exercises the same authenticated
// Upstash command path used by the financial lock/claim scripts without
// creating or modifying any Redis keys.
export async function checkAtomicStoreHealth() {
  const result = await command(['EVAL', "return redis.call('PING')", '0']);
  if (String(result || '').toUpperCase() !== 'PONG') {
    throw new Error('Seamless atomic store health check failed');
  }
  return true;
}

// Admin diagnostics only: exercise TIME inside EVAL without changing any keys.
export async function inspectPayoutCapacityStore() {
  const env = (Deno.env.get('SEAMLESS_ACH_ENV') || '').trim();
  if (!['sandbox', 'production'].includes(env)) return { error: 'invalid_environment' };
  const result: Record<string, unknown> = { environment: env };
  try {
    const records = parse(await command(['GET', key('payout-capacity', env)])) || {};
    result.capacity_records = Object.keys(records).length;
  } catch (error) {
    result.read_error = error.coordinationReason || 'unavailable';
  }
  try {
    await command(['EVAL', "return redis.call('TIME')", '0']);
    result.time_available = true;
  } catch (error) {
    result.time_available = false;
    result.reason = error.coordinationReason || 'unavailable';
    result.commands = error.coordinationCommands || [];
  }
  return result;
}

// Durable financial barriers outlive a worker's lease. Only recovery of the
// same challenge may bypass its barrier; deposits/withdrawals/other matches
// must not spend an incompletely materialized journal balance.
const ACQUIRE_WALLET_LOCK = `
local barrier = redis.call('GET', KEYS[2])
if barrier and barrier ~= ARGV[3] then return 0 end
local current = redis.call('GET', KEYS[1])
if current and current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;
export async function acquireUserWalletLock(userId: string, owner: string, recoveryMatchId = '') {
  const acquired = await evalAtomic(ACQUIRE_WALLET_LOCK,
    [key('wallet-lock', userId), key('wallet-barrier', userId)],
    [owner, String(LOCK_TTL_MS), recoveryMatchId]);
  return Number(acquired) === 1;
}

export async function getUserWalletBarrier(userId: string) {
  return String(await command(['GET', key('wallet-barrier', userId)]) || '');
}

export async function acquireMatchLock(matchId: string, owner: string) {
  return Number(await evalAtomic(ACQUIRE_LOCK, [key('match-lock', matchId)], [owner, String(LOCK_TTL_MS)])) === 1;
}
export async function releaseMatchLock(matchId: string, owner: string) {
  await evalAtomic(RELEASE_LOCK, [key('match-lock', matchId)], [owner]);
}

const SET_WALLET_BARRIERS = `
for i=1,#KEYS,2 do
  if redis.call('GET', KEYS[i]) ~= ARGV[1] then return 0 end
  local barrier = redis.call('GET', KEYS[i+1])
  if barrier and barrier ~= ARGV[2] then return 0 end
end
for i=1,#KEYS,2 do redis.call('SET', KEYS[i+1], ARGV[2]) end
return 1
`;
export async function setChallengeWalletBarriers(userIds: string[], owner: string, matchId: string) {
  const keys = userIds.flatMap(id => [key('wallet-lock', id), key('wallet-barrier', id)]);
  return Number(await evalAtomic(SET_WALLET_BARRIERS, keys, [owner, matchId])) === 1;
}
export async function clearChallengeWalletBarriers(userIds: string[], matchId: string) {
  for (const id of userIds) await evalAtomic(RELEASE_LOCK, [key('wallet-barrier', id)], [matchId]);
}

// Fixed-window rate limiting uses only GET and SET inside atomic EVAL, the
// commands already authorized for this store's financial coordination token.
// INCR is not permitted by its current command policy. Do not relax that
// policy or bypass rate limits; use the existing supported atomic primitives.
export const CHALLENGE_RATE_LIMIT_SCRIPT = `
local now = tonumber(ARGV[3])
local maximum = tonumber(ARGV[1])
local duration = tonumber(ARGV[2]) * 1000
local current = redis.call('GET', KEYS[1])
local record = current and cjson.decode(current) or { count = 0, until_ms = now + duration }
if tonumber(record.until_ms) <= now then record = { count = 0, until_ms = now + duration } end
if tonumber(record.count) >= maximum then return 0 end
record.count = tonumber(record.count) + 1
redis.call('SET', KEYS[1], cjson.encode(record), 'EX', ARGV[2])
return 1
`;
export async function takeChallengeRateLimit(scope: string, limit: number, seconds: number) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(seconds) || seconds < 1)
    throw new Error('Invalid challenge rate policy');
  const result = await evalAtomic(CHALLENGE_RATE_LIMIT_SCRIPT,
    [key('challenge-rate-v2', scope)], [String(limit), String(seconds), String(Date.now())]);
  return Number(result) === 1;
}

export async function releaseUserWalletLock(userId: string, owner: string) {
  await evalAtomic(RELEASE_LOCK, [key('wallet-lock', userId)], [owner]);
}

export async function refreshContestLocks(matchId: string, userIds: string[], owner: string) {
  const keys = [key('match-lock', matchId), ...userIds.map(id => key('wallet-lock', id))];
  // Only extend existing ownership. An expired lease can never be reacquired
  // by an old worker and mistaken for uninterrupted financial authorization.
  const script = `
for i,k in ipairs(KEYS) do if redis.call('GET',k) ~= ARGV[1] then return 0 end end
for i,k in ipairs(KEYS) do redis.call('SET',k,ARGV[1],'PX',ARGV[2]) end
return 1`;
  return Number(await evalAtomic(script, keys, [owner, String(LOCK_TTL_MS)])) === 1;
}

// One global ledger lease serializes journal creation and balance
// materialization across every wallet and protected system account. Financial
// volume is intentionally modest and correctness is more important than
// parallel posting. The deterministic ledger_group_id remains the durable
// idempotency key if a worker disappears after journaling but before all
// derived balances have been refreshed.
export async function acquireLedgerLock(owner: string) {
  const acquired = await evalAtomic(
    ACQUIRE_LOCK,
    [key('ledger-lock', 'global')],
    [owner, String(LOCK_TTL_MS)]
  );
  return Number(acquired) === 1;
}

export async function releaseLedgerLock(owner: string) {
  await evalAtomic(RELEASE_LOCK, [key('ledger-lock', 'global')], [owner]);
}

// Refresh only an existing lease. A delayed worker cannot reacquire an
// expired lease and then commit with an obsolete authorization.
export async function refreshLedgerLock(owner: string) {
  return Number(await evalAtomic(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]); return 1
`, [key('ledger-lock', 'global')], [owner, String(LOCK_TTL_MS)])) === 1;
}

async function claimPaymentOperation(kind: 'deposit' | 'withdrawal', userId: string, idempotencyKey: string, amount: number) {
  const recordKey = key(kind, `${userId}:${idempotencyKey}`);
  const proposed = JSON.stringify({ user_id: userId, idempotency_key: idempotencyKey, amount, state: 'new' });
  return parse(await evalAtomic(CLAIM_RECORD, [recordKey], [proposed, String(OP_TTL_SECONDS)]));
}

async function savePaymentOperation(kind: 'deposit' | 'withdrawal', userId: string, idempotencyKey: string, value: Record<string, unknown>) {
  const recordKey = key(kind, `${userId}:${idempotencyKey}`);
  return parse(await evalAtomic(SET_RECORD, [recordKey], [JSON.stringify(value), String(OP_TTL_SECONDS)]));
}

export function claimWithdrawalOperation(userId: string, idempotencyKey: string, amount: number) {
  return claimPaymentOperation('withdrawal', userId, idempotencyKey, amount);
}

export function saveWithdrawalOperation(userId: string, idempotencyKey: string, value: Record<string, unknown>) {
  return savePaymentOperation('withdrawal', userId, idempotencyKey, value);
}

export function claimDepositOperation(userId: string, idempotencyKey: string, amount: number) {
  return claimPaymentOperation('deposit', userId, idempotencyKey, amount);
}

export function saveDepositOperation(userId: string, idempotencyKey: string, value: Record<string, unknown>) {
  return savePaymentOperation('deposit', userId, idempotencyKey, value);
}

export async function claimWebhookEvent(eventKey: string, providerRef: string, owner: string) {
  const now = Date.now();
  return parse(await evalAtomic(
    CLAIM_WEBHOOK,
    [key('event', eventKey), key('provider-lock', providerRef || eventKey)],
    [owner, String(now), String(LOCK_TTL_MS), String(EVENT_TTL_SECONDS)]
  ));
}

export async function finishWebhookEvent(eventKey: string, providerRef: string, owner: string, state: 'completed' | 'retryable', error = '') {
  return parse(await evalAtomic(
    FINISH_WEBHOOK,
    [key('event', eventKey), key('provider-lock', providerRef || eventKey)],
    [owner, state, new Date().toISOString(), error.slice(0, 256), String(EVENT_TTL_SECONDS)]
  ));
}
