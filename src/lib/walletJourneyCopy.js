// Presentation only. Never used to grant eligibility or change transfer state.
export function walletJourneyCopy({ wallet = {}, funding = {}, pendingDeposits = 0 } = {}) {
  const recentDeposits = (funding.recent || []).filter(t => t.type === "deposit");
  const pending = Number(pendingDeposits) > 0 || recentDeposits.some(t => t.status === "pending");
  const clearing = Number(wallet.held_balance) > 0 || recentDeposits.some(t => t.status === "completed" && t.deposit_hold_status === "held");
  const funded = Number(wallet.available_balance ?? wallet.balance) > 0;
  const completed = funding.has_completed_deposit === true;
  const identity = funding.identity || {};
  const bankStarted = (funding.banks || []).length > 0;
  const progressed = pending || clearing || funded || completed || bankStarted || identity.verified || (identity.status && identity.status !== "not_started");
  const anotherDeposit = pending || clearing || funded || completed;
  let message = "Complete the checks below when you want to add money.";
  if (pending) message = "Deposit pending. Your request is already in progress; no need to submit it again. Follow processing and clearing in Transaction History.";
  else if (clearing) message = "Funds are clearing. They are not available to spend yet. Follow their progress in Transaction History.";
  else if (funded) message = "Your wallet has available funds. See your balance above and activity in Transaction History.";
  else if (completed) message = "Your previous deposit is complete. Your current balance and transaction history are shown here.";
  else if (identity.status === "rejected") message = "Identity verification was not approved. Review the status below for next steps.";
  else if (["pending", "review_required"].includes(identity.status)) message = identity.submitted ? "Identity verification submitted. Your result will update here; you do not need to start again." : "We are confirming your identity verification status. Your progress is shown below.";
  else if (identity.verified && (funding.banks || []).some(b => b.status === "verified")) message = "Identity verified and bank connected. Only a current location check is needed before a new deposit.";
  else if (identity.verified) message = "Identity verified. Review the remaining bank and location checks below.";
  else if (progressed) message = "Your verification progress is saved. Review any remaining steps below.";
  return {
    title: progressed ? "Wallet status" : "Wallet setup",
    message,
    anotherDeposit,
    locationDescription: anotherDeposit ? "A current location check is only needed if you want to make another deposit. It does not affect an existing deposit." : progressed ? "Check your current location before a new deposit. Your existing identity and bank progress stays saved." : "Check your location before continuing. Identity and bank verification follow.",
    locationAction: anotherDeposit ? "Check location for another deposit" : "Check location",
  };
}
