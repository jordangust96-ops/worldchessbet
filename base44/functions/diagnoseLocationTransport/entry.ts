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
  const body=await req.json().catch(()=>({}));
  let integrityProbe;
  if(body.probe===true) {
    // Fixed same-app endpoints only; no arbitrary URL, provider or account action.
    const fake='198.51.100.77', results=[];
    for(const host of ['base44.app','worldchessbet.com']) {
      const response=await fetch('https://'+host+'/api/apps/6a4ed72536c51cb3280d2bc6/functions/diagnoseLocationTransport',{
        method:'POST',headers:{'Authorization':req.headers.get('authorization')||'',
          'Content-Type':'application/json','True-Client-IP':fake,'CF-Connecting-IP':fake,
          'X-Forwarded-For':fake},body:'{}',signal:AbortSignal.timeout(10000)
      });
      const data=await response.json().catch(()=>({}));
      results.push({host,status:response.status,candidates:data.candidates||null,
        forgedValueSurvived:data.candidates?.['true-client-ip']===fake});
    }
    integrityProbe=results;
  }
  return Response.json({ok:true,integrityProbe,usedByJurisdiction:'true-client-ip',
    candidates,warning:'Diagnostic only. Forwarded header values are not independently authenticated visitor locations.'},
    {headers:{'Cache-Control':'no-store'}});
 } catch {return Response.json({error:'Transport inspection failed'},{status:500});}
});
