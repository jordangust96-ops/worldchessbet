import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { getOrCreateMatchGame } from '../../shared/getOrCreateMatchGame.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    return await getOrCreateMatchGame(base44, user, await req.json());
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
