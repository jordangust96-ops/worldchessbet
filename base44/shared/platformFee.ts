// Fixed-dollar Platform Service Fee schedule, effective 2026-07-28.
// The fee is separate from the Contest Entry Amount and never deducted from
// the Potential Winner Award. Amounts are expressed in USD.
export const PLATFORM_FEE_SCHEDULE_VERSION = '2026-07-28';

const FEE_TIERS = [
  { minCents: 500, maxCents: 1000, feeCents: 100 },
  { minCents: 1001, maxCents: 2500, feeCents: 200 },
  { minCents: 2501, maxCents: 5000, feeCents: 400 },
  { minCents: 5001, maxCents: 10000, feeCents: 600 },
  { minCents: 10001, maxCents: 25000, feeCents: 1000 },
  { minCents: 25001, maxCents: 50000, feeCents: 1500 },
  { minCents: 50001, maxCents: 100000, feeCents: 2000 },
  { minCents: 100001, maxCents: 250000, feeCents: 3000 },
  { minCents: 250001, maxCents: 500000, feeCents: 4000 },
];

export function getPlatformServiceFee(entryAmount: number): number | null {
  const cents = Math.round(Number(entryAmount) * 100);
  const tier = FEE_TIERS.find(({ minCents, maxCents }) => cents >= minCents && cents <= maxCents);
  return tier ? tier.feeCents / 100 : null;
}

export function requiresManualFeeApproval(entryAmount: number): boolean {
  return Math.round(Number(entryAmount) * 100) > 500000;
}
