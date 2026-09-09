import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({
    error: 'retired',
    action: 'Use the Seamless hosted Plaid bank-authorization flow.',
  }, { status: 410 });
});
