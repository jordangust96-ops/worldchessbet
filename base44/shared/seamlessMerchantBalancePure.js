// Pure pooled-funds reconciliation helpers. Provider cash is merchant-level;
// player balances remain authoritative only in ChessBet's internal ledger.

function money(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function reconcileSeamlessMerchantBalance({
  providerAvailableBalance,
  providerPendingBalance = 0,
  playerAvailableLiability,
  playerHeldLiability,
  pendingDepositAmount = 0,
  reservedWithdrawalAmount = 0,
  uncertainWithdrawalAmount = 0,
  snapshotAsOf,
  calculatedAt = new Date().toISOString(),
  staleAfterHours = 24,
}) {
  const providerAvailable = money(providerAvailableBalance, 'providerAvailableBalance');
  const providerPending = money(providerPendingBalance, 'providerPendingBalance');
  const playerAvailable = money(playerAvailableLiability, 'playerAvailableLiability');
  const playerHeld = money(playerHeldLiability, 'playerHeldLiability');
  const pendingDeposits = money(pendingDepositAmount, 'pendingDepositAmount');
  const reservedWithdrawals = money(reservedWithdrawalAmount, 'reservedWithdrawalAmount');
  const uncertainWithdrawals = money(uncertainWithdrawalAmount, 'uncertainWithdrawalAmount');
  const asOfMs = Date.parse(String(snapshotAsOf || ''));
  const calculatedMs = Date.parse(String(calculatedAt || ''));
  if (!Number.isFinite(asOfMs) || !Number.isFinite(calculatedMs)) throw new Error('valid snapshot timestamps required');

  const playerLedgerLiability = money(playerAvailable + playerHeld, 'playerLedgerLiability');
  const settledCoverageVariance = money(Math.abs(providerAvailable - playerLedgerLiability), 'settledCoverageVariance') *
    (providerAvailable < playerLedgerLiability ? -1 : 1);
  const providerTotal = money(providerAvailable + providerPending, 'providerTotal');
  const snapshotAgeHours = Math.max(0, (calculatedMs - asOfMs) / 3_600_000);
  const stale = snapshotAgeHours > staleAfterHours;
  const coverageRatio = playerLedgerLiability === 0
    ? null
    : Math.round((providerAvailable / playerLedgerLiability) * 10000) / 10000;
  const status = stale ? 'stale_snapshot' : settledCoverageVariance < 0 ? 'shortfall' : 'covered';

  return {
    provider_available_balance: providerAvailable,
    provider_pending_balance: providerPending,
    provider_total_balance: providerTotal,
    player_available_liability: playerAvailable,
    player_held_liability: playerHeld,
    player_ledger_liability: playerLedgerLiability,
    pending_deposit_amount: pendingDeposits,
    reserved_withdrawal_amount: reservedWithdrawals,
    uncertain_withdrawal_amount: uncertainWithdrawals,
    settled_coverage_variance: settledCoverageVariance,
    coverage_ratio: coverageRatio,
    snapshot_age_hours: Math.round(snapshotAgeHours * 100) / 100,
    status,
  };
}
