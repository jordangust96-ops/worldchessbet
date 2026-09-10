import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { walletOnboardingLocation } from '../../shared/walletOnboardingLocation.ts';
import { getRequestJurisdiction } from '../../shared/requestJurisdiction.ts';
import { acquireUserWalletLock, releaseUserWalletLock } from '../../shared/seamlessAtomicStore.ts';

Deno.serve(async (req) => {
  let userId = '', owner = '';
  try {
    if (req.method !== 'POST') return Response.json({error:'Method not allowed'}, {status:405});
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({error:'Unauthorized'}, {status:401});
    const user = await base44.asServiceRole.entities.User.get(caller.id);
    if (['suspended','closed'].includes(user.account_state) || user.withdrawal_hold)
      return Response.json({error:'Your account is restricted. Contact support.'}, {status:403});
    const saved = await walletOnboardingLocation(base44, user.id);
    if (saved.allowed) return Response.json(saved);
    userId = user.id;
    const candidate = crypto.randomUUID();
    if (!await acquireUserWalletLock(userId, candidate))
      return Response.json({error:'Another account request is processing. Please try again shortly.'}, {status:409});
    owner = candidate;
    const latest = await walletOnboardingLocation(base44, userId);
    if (latest.allowed) return Response.json(latest);
    // Always use the trusted edge IP, not client-supplied body/approval.
    // No admin bypass: the green check means a real recorded approval.
    const response = await getRequestJurisdiction(req, {triggerEvent:'wallet_onboarding'},
      {fresh:true, requireLocation:true});
    if (!response.ok) return Response.json({error:'Location verification is unavailable. Please try again.'}, {status:503});
    // Read back the immutable audit record; never approve from a browser result.
    return Response.json(await walletOnboardingLocation(base44, userId));
  } catch {
    return Response.json({error:'Location verification is unavailable. Please try again.'}, {status:503});
  } finally {
    if (userId && owner) await releaseUserWalletLock(userId, owner).catch(() => {});
  }
});
