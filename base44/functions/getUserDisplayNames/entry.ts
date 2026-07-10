import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Returns public display names (ChessBet username, falling back to first name)
// for a set of user IDs. Needed because the built-in User entity only allows a
// non-admin to read their own record via the client SDK — this lets the UI
// resolve an opponent's actual username instead of always falling back to
// the generic "Opponent" placeholder.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { userIds } = await req.json();
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return Response.json({ error: 'userIds array is required' }, { status: 400 });
    }

    const names = {};
    await Promise.all(
      userIds.filter(Boolean).map(async (id) => {
        try {
          const target = await base44.asServiceRole.entities.User.get(id);
          if (target?.chess_com_username?.trim()) {
            names[id] = target.chess_com_username.trim();
          } else if (target?.full_name?.trim()) {
            names[id] = target.full_name.trim().split(' ')[0];
          } else {
            names[id] = null;
          }
        } catch (e) {
          names[id] = null;
        }
      })
    );

    return Response.json({ names });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});