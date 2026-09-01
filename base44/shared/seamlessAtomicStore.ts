// Server-only atomic claim store for Seamless financial operations. Upstash Redis
// executes each Lua EVAL atomically, allowing independent per-user/event locks
// across Base44 function instances. No browser code imports this module.
const PREFIX = 'chessbet:seamless:v1';
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
  if (!response.ok || payload?.error) throw new Error('Seamless atomic store unavailable');
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
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
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

export async function acquireUserWalletLock(userId: string, owner: string) {
  const acquired = await evalAtomic(ACQUIRE_LOCK, [key('wallet-lock', userId)], [owner, String(LOCK_TTL_MS)]);
  return Number(acquired) === 1;
}

export async function releaseUserWalletLock(userId: string, owner: string) {
  await evalAtomic(RELEASE_LOCK, [key('wallet-lock', userId)], [owner]);
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
