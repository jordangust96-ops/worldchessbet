// Player-safe explanations for failed ACH transfers. Backend descriptions are
// treated as signals, not arbitrary display copy, so old or technical records
// cannot leak provider internals into the wallet.
export function getTransferFailureMessage(tx) {
  const direction = tx?.type === "withdrawal" ? "withdrawal" : "deposit";
  const details = String(tx?.description || "").toLowerCase();

  if (/insufficient|not sufficient|nsf|available funds|sufficient funds/.test(details)) {
    return direction === "deposit"
      ? "Your bank could not complete this deposit. Check that the account has enough available funds, or use a different connected bank."
      : "Your bank could not complete this withdrawal because the destination account may be unable to accept it.";
  }
  if (/closed|frozen|restricted|blocked/.test(details)) {
    return "This bank account is currently restricted or unavailable. Use a different connected bank or contact your bank.";
  }
  if (/invalid.*account|account.*invalid|routing/.test(details)) {
    return "The connected bank details could not be used. Reconnect the bank account or choose a different one.";
  }
  if (/authoriz|permission|not permitted/.test(details)) {
    return "The bank did not authorize this transfer. Reconnect the account or contact your bank.";
  }
  return direction === "deposit"
    ? "Your bank declined this deposit. Check your available balance or use a different connected bank."
    : "Your bank declined this withdrawal. Confirm the account is open and able to receive ACH transfers.";
}
