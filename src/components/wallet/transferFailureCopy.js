// Player-safe explanations for failed ACH transfers. Backend descriptions are
// treated as signals, not arbitrary display copy, so old or technical records
// cannot leak provider internals into the wallet. Preflight, review, and
// reconnect conditions are never described as provider rejection.
export function getTransferFailureMessage(tx) {
  const direction = tx?.type === "withdrawal" ? "withdrawal" : "deposit";
  const details = String(tx?.description || "").toLowerCase();

  // Distinct preflight/review/reconnect conditions — never "rejected".
  if (/destination_changed/.test(details)) {
    return "The bank account selected for this withdrawal no longer matches your current primary bank. Start a new withdrawal after confirming your bank.";
  }
  if (/destination_missing/.test(details)) {
    return "No primary bank account is currently selected for withdrawals. Add or select a bank and try again.";
  }
  if (/destination_multiple_primary/.test(details)) {
    return "Multiple primary bank accounts were found. Contact support to resolve this before withdrawing.";
  }
  if (/destination_deleted/.test(details)) {
    return "The bank account selected for this withdrawal has been removed. Reconnect a bank and try again.";
  }
  if (/reconnect_required|login_required|verification_expired/.test(details)) {
    return "The bank account selected for this withdrawal needs to be reconnected. Reconnect your bank and try again.";
  }
  if (/merchant_unavailable|merchant_balance_unavailable/.test(details)) {
    return "ChessBet payment funding is temporarily unavailable for withdrawals. Please try again later.";
  }
  if (/preflight_uncertain|preflight_indeterminate/.test(details)) {
    return "We could not confirm your bank status with the payment provider. Your funds remain reserved while we check. Do not submit another withdrawal; check Transaction History for updates.";
  }
  if (/insufficient|not sufficient|\bnsf\b|available funds|sufficient funds/.test(details)) {
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
    : "This withdrawal could not be completed. Contact ChessBet support if the issue continues.";
}