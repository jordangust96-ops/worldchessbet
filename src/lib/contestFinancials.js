// Single source of truth for the Contest Entry Amount / Platform Service Fee
// split shown across hosting, acceptance, settlement, and receipts. The
// Platform Service Fee is 10% of the Contest Entry Amount, charged and
// tracked completely separately from the Entry Amount itself — it is never
// part of the Contest Pool and never deducted from a winner's payout.
export const SERVICE_FEE_RATE = 0.1;

export function computeContestFinancials(entryAmount) {
  const entry = Number(entryAmount) || 0;
  const serviceFee = Math.round(entry * SERVICE_FEE_RATE * 100) / 100;
  const totalCharge = Math.round((entry + serviceFee) * 100) / 100;
  const potentialWinnerAward = Math.round(entry * 2 * 100) / 100;
  return { entryAmount: entry, serviceFee, totalCharge, potentialWinnerAward };
}