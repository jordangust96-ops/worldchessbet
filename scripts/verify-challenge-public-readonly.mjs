// Read-only deployment smoke checks. Never creates an account, invitation,
// match, deposit, withdrawal, reservation, or email.
import fs from 'node:fs';
import { createClient } from '@base44/sdk';
const origin = 'https://worldchessbet.com';
const sdk = createClient({ appId:'6a4ed72536c51cb3280d2bc6', serverUrl:origin,
  requiresAuth:false, analytics:{enabled:false} });
const report = { checkedAt:new Date().toISOString(), probes:[] };
for (const body of [
  {action:'view',inviteCode:'invalid-link'},
  {action:'view',inviteCode:'00000000000000000000000000000000'},
  {action:'list'},
]) {
  try {
    const result = await sdk.functions.invoke('manageChallenge',body);
    report.probes.push({action:body.action,status:result.status,data:result.data});
  } catch(error) {
    report.probes.push({action:body.action,status:error.response?.status ?? null,data:error.response?.data ?? {error:'transport_failed'}});
  }
}
try {
  const html = await (await fetch(origin+'/play',{signal:AbortSignal.timeout(12000)})).text();
  const asset = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(x=>x[1]).find(x=>x.startsWith('/assets/index-'));
  report.publishedAsset = asset;
  const code = await (await fetch(origin+asset,{signal:AbortSignal.timeout(12000)})).text();
  const app = code.match(/AuthenticatedApplication-[A-Za-z0-9_-]+\.js/)?.[0];
  const routes = app ? await (await fetch(origin+'/assets/'+app,{signal:AbortSignal.timeout(12000)})).text() : '';
  report.challengeRoutePublished = routes.includes('/challenge/:inviteCode');
  report.localAsset = fs.existsSync('dist/index.html') ? fs.readFileSync('dist/index.html','utf8').match(/\/assets\/index-[^"]+\.js/)?.[0] : null;
} catch { report.siteError='Unable to verify published assets'; }
console.log(JSON.stringify(report,null,2));
