// Initial deadline is written atomically with the transaction.
// Ledger processing and the daily sweep may extend it after later activity.
export function initialWalletRetentionDeadline() {
  const deadline = new Date();
  deadline.setUTCFullYear(deadline.getUTCFullYear() + 2);
  return deadline.toISOString();
}
