// Conservative payout windows: no dependency on an unverified provider reset timezone.
export const MAX_WITHDRAWAL_AMOUNT = 1100;
export const PAYOUT_DAY_CENTS = 110000;
export const PAYOUT_MONTH_CENTS = 2200000;
export const DAY_MS = 86400000;
export const MONTH_WINDOW_MS = 31 * DAY_MS;

export function withdrawalCents(amount) {
  const value = Number(amount);
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || cents < 1 || cents > PAYOUT_DAY_CENTS ||
      Math.abs(value * 100 - cents) > 0.000001) {
    throw new Error('Enter a withdrawal between $0.01 and $1,100.00 with no more than two decimal places.');
  }
  return cents;
}

export function payoutCapacity(entries, cents, now) {
  const recent = entries.filter(e => e.at > now - MONTH_WINDOW_MS);
  const month = recent.reduce((sum, e) => sum + e.cents, 0);
  const day = recent.filter(e => e.at > now - DAY_MS).reduce((sum, e) => sum + e.cents, 0);
  return { allowed: day + cents <= PAYOUT_DAY_CENTS && month + cents <= PAYOUT_MONTH_CENTS,
    availableCents: Math.max(0, Math.min(PAYOUT_DAY_CENTS - day, PAYOUT_MONTH_CENTS - month)) };
}

// Redis executes this entire capacity election atomically across all users and workers.
// Entries survive unknown provider outcomes; an id may never authorize a second send.
export const CLAIM_PAYOUT_CAPACITY = `
-- Timestamp comes only from trusted backend code, never a request field.
-- TIME is not authorized by the production Redis command policy.
local now = tonumber(ARGV[4])
if not now or now <= 0 or now ~= math.floor(now) then
  return redis.error_reply('Invalid payout clock')
end
local dayWindow = 86400000
local monthWindow = 2678400000
local records = cjson.decode(redis.call('GET', KEYS[1]) or '{}')
local historical = cjson.decode(ARGV[3])
for _, entry in ipairs(historical) do
  if not records[entry.id] then records[entry.id] = {at=entry.at, cents=entry.cents} end
end
local day = 0
local month = 0
for id, entry in pairs(records) do
  if tonumber(entry.at) <= now - monthWindow then
    records[id] = nil
  else
    month = month + tonumber(entry.cents)
    if tonumber(entry.at) > now - dayWindow then day = day + tonumber(entry.cents) end
  end
end
local cents = tonumber(ARGV[2])
if records[ARGV[1]] then return cjson.encode({allowed=false, duplicate=true}) end
local available = math.max(0, math.min(110000-day, 2200000-month))
if cents > available then
  if ARGV[5] ~= 'inspect' then redis.call('SET', KEYS[1], cjson.encode(records)) end
  return cjson.encode({allowed=false, availableCents=available})
end
if ARGV[5] == 'inspect' then return cjson.encode({allowed=true, availableCents=available, inspect_only=true}) end
records[ARGV[1]] = {at=now, cents=cents}
redis.call('SET', KEYS[1], cjson.encode(records))
return cjson.encode({allowed=true})
`;
