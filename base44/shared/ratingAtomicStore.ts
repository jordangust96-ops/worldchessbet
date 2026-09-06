// Server-only global serialization lock for the shadow rating pipeline.
//
// Ratings are intentionally non-critical. If the atomic store is unavailable,
// rating processing FAILS CLOSED and simply retries later; gameplay, contest
// settlement, wallets, payouts, and fair-play processing are never affected.
//
// Prefer dedicated rating Redis credentials when configured. During launch,
// ChessBet may safely reuse the already-configured Seamless Upstash transport;
// keys are isolated under their own prefix and never overlap financial locks.
const PREFIX = 'chessbet:ratings:v1';
const LOCK_TTL_MS = 5 * 60 * 1000;

function config() {
  const url = (
    Deno.env.get('RATING_ATOMIC_REDIS_REST_URL') ||
    Deno.env.get('SEAMLESS_ATOMIC_REDIS_REST_URL') ||
    ''
  ).trim().replace(/\/$/, '');
  const token = (
    Deno.env.get('RATING_ATOMIC_REDIS_REST_TOKEN') ||
    Deno.env.get('SEAMLESS_ATOMIC_REDIS_REST_TOKEN') ||
    ''
  ).trim();
  if (!url || !token) throw new Error('Rating atomic store is not configured');
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
  if (!response.ok || payload?.error) throw new Error('Rating atomic store unavailable');
  return payload?.result;
}

const ACQUIRE_OR_RENEW = `
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

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

async function evalAtomic(script: string, keys: string[], args: string[]) {
  return command(['EVAL', script, String(keys.length), ...keys, ...args]);
}

function lockKey() {
  return `${PREFIX}:global-processing-lock`;
}

export async function acquireRatingProcessingLock(owner: string) {
  const result = await evalAtomic(ACQUIRE_OR_RENEW, [lockKey()], [owner, String(LOCK_TTL_MS)]);
  return Number(result) === 1;
}

export async function renewRatingProcessingLock(owner: string) {
  return acquireRatingProcessingLock(owner);
}

export async function releaseRatingProcessingLock(owner: string) {
  await evalAtomic(RELEASE, [lockKey()], [owner]);
}
