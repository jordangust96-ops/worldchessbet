// v2 includes a $0.10 balance-check allowance and $0.10 verification cushion.
// Provider deductions remain subject to actual settlement evidence.
export const DEPOSIT_PRICING_VERSION = 'same-day-ach-v2';
export const MAX_BANK_DEBIT_CENTS = 110000;
export function depositQuote(amount, version = DEPOSIT_PRICING_VERSION) {
  if (!['same-day-ach-v1', 'same-day-ach-v2'].includes(version)) return null;
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(Number(amount)) || cents < 1000 || Math.abs(Number(amount) * 100 - cents) > 0.000001) return null;
  const allowance = version === 'same-day-ach-v2' ? 20 : 0;
  let gross = Math.ceil((cents + 50 + allowance) * 200 / 199) - 1;
  while (gross - Math.floor((gross + 100) / 200) - 50 - allowance < cents) gross += 1;
  if (gross > MAX_BANK_DEBIT_CENTS) return null;
  return { version, walletAmount: cents / 100, fee: (gross - cents) / 100, bankDebit: gross / 100 };
}
