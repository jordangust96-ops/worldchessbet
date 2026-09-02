import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (user.launch_epoch !== 2) {
      await base44.asServiceRole.entities.User.update(user.id, {
        launch_epoch: 2,
        games_played: 0,
        games_won: 0,
        games_lost: 0,
        win_percentage: 0,
      });
    }

    return Response.json({ ok: true, launch_epoch: 2, migrated: user.launch_epoch !== 2 });
  } catch (error) {
    console.error(JSON.stringify({ event: "launch_epoch_migration_failed", error: error?.message || "unknown_error" }));
    return Response.json({ error: "Unable to prepare this account for launch" }, { status: 500 });
  }
});