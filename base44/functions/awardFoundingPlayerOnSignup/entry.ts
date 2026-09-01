import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { awardFoundingPlayerBadge, FOUNDING_PLAYER_CAP } from '../../shared/foundingPlayer.ts';
import { ensureUserWallet } from '../../shared/walletProvisioning.ts';

// Invoked by the FoundingPlayerOnSignup workflow whenever a new User record
// is created. Awards the Founding Player badge to the new user as long as
// the 250-user cap has not yet been reached.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const { userId } = await req.json();
    if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

    const targetUser = await base44.asServiceRole.entities.User.get(userId);
    if (!targetUser) return Response.json({ error: 'User not found' }, { status: 404 });

    // Signup is the authoritative wallet-provisioning point. Page-level calls
    // remain a recovery path if this workflow is delayed.
    const wallet = await ensureUserWallet(base44, targetUser.id);
    if (targetUser.founding_player) {
      return Response.json({ awarded: false, alreadyAwarded: true, wallet });
    }

    const currentFounders = await base44.asServiceRole.entities.User.filter({ founding_player: true });
    if (currentFounders.length >= FOUNDING_PLAYER_CAP) {
      return Response.json({ awarded: false, capReached: true });
    }

    const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/$/, '');
    const result = await awardFoundingPlayerBadge(base44, targetUser, appUrl);
    return Response.json({ ...result, wallet });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}