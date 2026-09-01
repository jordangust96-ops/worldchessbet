// Provision a zero-balance wallet for an authenticated user. This helper never
// posts ledger entries or creates promotional funds.
export async function ensureUserWallet(base44, userId) {
  let wallet = (await base44.asServiceRole.entities.Wallet.filter({ user_id: userId }))[0];
  if (wallet) return wallet;

  return await base44.asServiceRole.entities.Wallet.create({
    user_id: userId,
    balance: 0,
    available_balance: 0,
    held_balance: 0,
    total_balance: 0,
    total_wagered: 0,
    total_won: 0,
    total_deposited: 0,
    total_withdrawn: 0,
    early_access_credited: false,
  });
}
