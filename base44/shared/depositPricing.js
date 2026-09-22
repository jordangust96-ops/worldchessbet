// v3 prices each deposit so its proceeds cover:
// - Seamless debit fee: 0.5% + $0.50
// - Plaid Balance allowance: $0.10
// - future standard same-day ACH payout fee: $0.50
// The player still receives the full requested wallet principal. No withdrawal
// fee is charged to the player for this standard payout cost.
export const DEPOSIT_PRICING_VERSION = 'same-day-ach-v3';
export const MAX_BANK_DEBIT_CENTS = 110000;
export const STANDARD_PAYOUT_RESERVE_CENTS = 50;
export function depositQuote(amount, version = DEPOSIT_PRICING_VERSION) {
  if (!['same-day-ach-v1', 'same-day-ach-v2', 'same-day-ach-v3'].includes(version)) return null;
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(Number(amount)) || cents < 1000 || Math.abs(Number(amount) * 100 - cents) > 0.000001) return null;
  const allowance = version === 'same-day-ach-v3' ? 60 : version === 'same-day-ach-v2' ? 20 : 0;
  let gross = Math.ceil((cents + 50 + allowance) * 200 / 199) - 1;
  while (gross - Math.floor((gross + 100) / 200) - 50 - allowance < cents) gross += 1;
  if (gross > MAX_BANK_DEBIT_CENTS) return null;
  return {
    version,
    walletAmount: cents / 100,
    fee: (gross - cents) / 100,
    bankDebit: gross / 100,
    payoutReserve: version === 'same-day-ach-v3' ? STANDARD_PAYOUT_RESERVE_CENTS / 100 : 0,
  };
}
