// Published fixed-dollar Platform Service Fee schedule. The fee is separate
// from the Contest Entry Amount, never part of the Contest Pool, and never
// deducted from a winner's payout.
export const PLATFORM_FEE_SCHEDULE_VERSION = "2026-07-28";

const FEE_TIERS = [
  { minCents: 500, maxCents: 1000, fee: 1 },
  { minCents: 1001, maxCents: 2500, fee: 2 },
  { minCents: 2501, maxCents: 5000, fee: 4 },
  { minCents: 5001, maxCents: 10000, fee: 6 },
  { minCents: 10001, maxCents: 25000, fee: 10 },
  { minCents: 25001, maxCents: 50000, fee: 15 },
  { minCents: 50001, maxCents: 100000, fee: 20 },
  { minCents: 100001, maxCents: 250000, fee: 30 },
  { minCents: 250001, maxCents: 500000, fee: 40 },
];

export function getPlatformServiceFee(entryAmount) {
  const cents = Math.round((Number(entryAmount) || 0) * 100);
  const tier = FEE_TIERS.find(({ minCents, maxCents }) => cents >= minCents && cents <= maxCents);
  return tier ? tier.fee : null;
}

export function computeContestFinancials(entryAmount, disclosedFee) {
  const entry = Number(entryAmount) || 0;
  const serviceFee = Number.isFinite(Number(disclosedFee))
    ? Number(disclosedFee)
    : getPlatformServiceFee(entry);
  const totalCharge = serviceFee === null ? null : Math.round((entry + serviceFee) * 100) / 100;
  const potentialWinnerAward = Math.round(entry * 2 * 100) / 100;
  return {
    entryAmount: entry,
    serviceFee,
    totalCharge,
    potentialWinnerAward,
    requiresManualApproval: entry > 5000,
  };
}
