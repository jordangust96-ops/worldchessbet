import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { requireAdminMfa } from '../../shared/mfa.ts';
import { accountDeletionAction } from '../../shared/accountDeletion.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({error:'method_not_allowed'},{status:405});
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(()=>null);
    if (!user) return Response.json({error:'unauthorized'},{status:401});
    let body;
    try { body = await req.json(); } catch { return Response.json({error:'invalid_json'},{status:400}); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({error:'invalid_request'},{status:400});
    if (!['status','request'].includes(body.action || 'status')) {
      const mfaError = await requireAdminMfa(base44,user,body.mfaSessionToken,req.headers.get('user-agent') || '');
      if (mfaError) return mfaError;
    }
    const requests = base44.asServiceRole.entities.AccountDeletionRequest;
    const store = {
      forUser: id => requests.filter({user_id:id},'-requested_at',100),
      create: data => requests.create(data),
      get: id => requests.get(id),
      list: (limit,skip) => requests.list('-requested_at',limit,skip),
      update: (id,data) => requests.update(id,data),
      authUserMissing: async id => {
        try { await base44.asServiceRole.entities.User.get(id); return false; }
        catch(error) {
          if (Number(error?.status || error?.response?.status) === 404) return true;
          throw error;
        }
      },
    };
    const result = await accountDeletionAction({user,body,store});
    return Response.json(result.body,{status:result.status});
  } catch {
    console.error(JSON.stringify({event:'account_deletion_failed'}));
    return Response.json({error:'request_unavailable'},{status:503});
  }
});
