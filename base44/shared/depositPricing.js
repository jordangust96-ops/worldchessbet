// Customer pays the configured ACH debit processing cost on the full bank charge.
export const DEPOSIT_PRICING_VERSION = 'same-day-ach-v1';
export const MAX_BANK_DEBIT_CENTS = 110000;
export function depositQuote(amount) {
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(Number(amount)) || cents < 1000 || Math.abs(Number(amount) * 100 - cents) > 0.000001) return null;
  // Solve gross - round(gross * 0.5% + $0.50) = wallet credit, in cents.
  let gross = Math.ceil((cents + 50) * 200 / 199) - 1;
  while (gross - Math.floor((gross + 100) / 200) - 50 < cents) gross += 1;
  if (gross > MAX_BANK_DEBIT_CENTS) return null;
  return { version: DEPOSIT_PRICING_VERSION, walletAmount: cents / 100, fee: (gross - cents) / 100, bankDebit: gross / 100 };
}
