// Server-only durable serialization for the shared financial ledger. This is
// intentionally small: Redis only owns locks/idempotency records; immutable
// Base44 LedgerEntry rows remain the financial source of truth.
const PREFIX = 'chessbet:financial:v1';
const LOCK_TTL_MS = 3 * 60 * 1000;
const OP_TTL_SECONDS = 60 * 60 * 24 * 365 * 7;

function config() {
  const url = (Deno.env.get('FINANCIAL_ATOMIC_REDIS_REST_URL') || Deno.env.get('SEAMLESS_ATOMIC_REDIS_REST_URL') || '').trim().replace(/\/$/, '');
  const token = (Deno.env.get('FINANCIAL_ATOMIC_REDIS_REST_TOKEN') || Deno.env.get('SEAMLESS_ATOMIC_REDIS_REST_TOKEN') || '').trim();
  if (!url || !token) throw new Error('Financial atomic store is not configured');
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
  if (!response.ok || payload?.error) throw new Error('Financial atomic store unavailable');
  return payload?.result;
}
async function evalAtomic(script: string, keys: string[], args: string[]) {
  return command(['EVAL', script, String(keys.length), ...keys, ...args]);
}
function key(kind: string, id: string) { return `${PREFIX}:${kind}:${id}`; }
function parse(value: unknown) { try { return JSON.parse(String(value || '')); } catch { return null; } }

const CLAIM_LOCK = `
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
const CLAIM_OPERATION = `
local current = redis.call('GET', KEYS[1])
if current then return current end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return ARGV[1]
`;
const SAVE_OPERATION = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return ARGV[1]
`;

export async function acquireFinancialLedgerLock(owner: string) {
  return Number(await evalAtomic(CLAIM_LOCK, [key('lock', 'global')], [owner, String(LOCK_TTL_MS)])) === 1;
}
export async function releaseFinancialLedgerLock(owner: string) {
  await evalAtomic(RELEASE_LOCK, [key('lock', 'global')], [owner]);
}
export async function claimFinancialOperation(operationId: string, planHash: string) {
  const proposed = JSON.stringify({ operation_id: operationId, plan_hash: planHash, state: 'pending' });
  const record = parse(await evalAtomic(CLAIM_OPERATION, [key('operation', operationId)], [proposed, String(OP_TTL_SECONDS)]));
  if (!record || record.plan_hash !== planHash) throw new Error('Financial operation ID reuse has a different plan');
  return record;
}
export async function saveFinancialOperation(operationId: string, value: Record<string, unknown>) {
  return parse(await evalAtomic(SAVE_OPERATION, [key('operation', operationId)], [JSON.stringify(value), String(OP_TTL_SECONDS)]));
}