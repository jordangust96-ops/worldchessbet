import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { awardFoundingPlayerBadge, FOUNDING_PLAYER_CAP } from '../../shared/foundingPlayer.ts';

// One-off admin action: awards the Founding Player badge to existing users
// (oldest accounts first) up to the 250-user cap, sending each a branded
// notification email. Safe to re-run — already-badged users and any users
// beyond the remaining cap are skipped.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/$/, '');

    const alreadyFounding = await base44.asServiceRole.entities.User.filter({ founding_player: true });
    const remainingSlots = FOUNDING_PLAYER_CAP - alreadyFounding.length;
    if (remainingSlots <= 0) {
      return Response.json({ awarded: 0, message: 'Founding Player cap already reached.' });
    }

    const allUsers = await base44.asServiceRole.entities.User.list('created_date', 5000);
    const candidates = allUsers.filter((u) => !u.founding_player).slice(0, remainingSlots);

    const results = [];
    for (const candidate of candidates) {
      const result = await awardFoundingPlayerBadge(base44, candidate, appUrl);
      results.push({ userId: candidate.id, email: candidate.email, ...result });
    }

    return Response.json({ awarded: results.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}