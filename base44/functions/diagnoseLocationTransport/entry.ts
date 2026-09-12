import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
// Read-only admin transport inspection. Never use these unverified candidates
// to authorize location; the forwarding trust contract must be verified first.
Deno.serve(async req => {
 try {
  const base44=createClientFromRequest(req);
  const user=await base44.auth.me().catch(()=>null);
  if(!user)return Response.json({error:'Unauthorized'},{status:401});
  if(user.role!=='admin')return Response.json({error:'Forbidden'},{status:403});
  const names=['cf-connecting-ip','x-forwarded-for','x-real-ip','true-client-ip',
    'x-client-ip','x-original-forwarded-for','forwarded','cf-ipcountry','cf-ray'];
  const candidates={};
  for(const name of names){const value=req.headers.get(name);if(value)candidates[name]=value.slice(0,512);}
  return Response.json({ok:true,usedByJurisdiction:'cf-connecting-ip',
    candidates,warning:'Diagnostic only. Forwarded header values are not independently authenticated visitor locations.'},
    {headers:{'Cache-Control':'no-store'}});
 } catch {return Response.json({error:'Transport inspection failed'},{status:500});}
});
