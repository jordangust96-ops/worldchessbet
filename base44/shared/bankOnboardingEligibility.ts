import { hasVerifiedIdentity } from './identityEligibility.js';
import { getRequestJurisdiction } from './requestJurisdiction.ts';
// Bank linking for new funding requires location then KYC. A verified player's
// existing withdrawable funds remain accessible when their location is restricted.
export async function bankOnboardingEligibility(req, base44, user) {
  const current = await base44.asServiceRole.entities.User.get(user.id);
  if (!await hasVerifiedIdentity(base44,current) || current.withdrawal_hold)
    return {error:'Complete identity verification and resolve account restrictions before connecting a bank.'};
  const wallets = await base44.asServiceRole.entities.Wallet.filter({user_id:current.id});
  if (wallets.some(wallet => Number(wallet.available_balance || 0) > 0)) return null;
  const response = await getRequestJurisdiction(req,{triggerEvent:'bank_verification_start'});
  const location = await response.json();
  return response.ok && location.status === 'approved' ? null :
    {error:location.reason || 'Bank connection is unavailable from your current location.'};
}
