const PROD='https://riskos.socure.com';
const SANDBOX='https://riskos.sandbox.socure.com';
export function identityConfig() {
  const enabled=Deno.env.get('SOCURE_IDENTITY_ENABLED')==='true';
  if (!enabled) return {enabled:false};
  const environment=(Deno.env.get('SOCURE_IDENTITY_ENV')||'production').trim().toLowerCase();
  const apiKey=(Deno.env.get('SOCURE_IDENTITY_API_KEY')||'').trim();
  const workflow=(Deno.env.get('SOCURE_IDENTITY_WORKFLOW')||'consumer_onboarding').trim();
  const redirectUri=(Deno.env.get('SOCURE_IDENTITY_RETURN_URL')||'').trim();
  const webhookToken=(Deno.env.get('SOCURE_IDENTITY_WEBHOOK_TOKEN')||'').trim();
  if (!['production','sandbox'].includes(environment)||!apiKey||!workflow||!redirectUri.startsWith('https://')||!webhookToken) throw new Error('Socure identity configuration is incomplete');
  return {enabled:true,environment,apiKey,workflow,redirectUri,webhookToken,baseUrl:environment==='production'?PROD:SANDBOX};
}
export async function startIdentityEvaluation(config:any, requestId:string) {
  const res=await fetch(config.baseUrl+'/api/evaluation',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({id:requestId,timestamp:new Date().toISOString(),workflow:config.workflow,data:{custom:{redirect_uri:config.redirectUri}}}),signal:AbortSignal.timeout(12000)});
  const body=await res.json().catch(()=>null);
  if(!res.ok||!body?.eval_id||!body?.redirect_uri) throw new Error('socure_identity_start_failed');
  return body;
}
export function constantTimeEqual(a:string,b:string) { let d=a.length^b.length; const m=Math.max(a.length,b.length); for(let i=0;i<m;i++) d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0); return d===0; }