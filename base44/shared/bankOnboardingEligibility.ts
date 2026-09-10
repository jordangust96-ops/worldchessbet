import { hasVerifiedIdentity } from './identityEligibility.js';
import { walletOnboardingLocation } from './walletOnboardingLocation.ts';
// Bank linking for new funding requires location then KYC. A verified player's
// existing withdrawable funds remain accessible when their location is restricted.
export async function bankOnboardingEligibility(req, base44, user) {
  const current = await base44.asServiceRole.entities.User.get(user.id);
  if (!await hasVerifiedIdentity(base44,current) || current.withdrawal_hold)
    return {error:'Complete identity verification and resolve account restrictions before connecting a bank.'};
  const wallets = await base44.asServiceRole.entities.Wallet.filter({user_id:current.id});
  if (wallets.some(wallet => Number(wallet.available_balance || 0) > 0)) return null;
  const location = await walletOnboardingLocation(base44, current.id);
  return location.allowed ? null :
    {error:'Complete the one-time location check in wallet setup.'};
}
