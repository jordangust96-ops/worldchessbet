import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
const { handler } = await loadBackend('base44/functions/reconcileLegacyLaunchDeposit/entry.ts');
for (const body of [{}, { commit: true }]) {
  const response = await handler(new Request('https://test.invalid', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: 'legacy_deposit_repair_retired' });
}
let sent=[],notification={id:'new',user_id:'test',type:'deposit',amount:20,status:'completed',deposit_hold_status:'released'};
const emailBase={asServiceRole:{entities:{WalletTransaction:{get:async()=>notification,update:async(id,p)=>Object.assign(notification,p)},User:{get:async()=>({email:'mock@example.invalid',full_name:'Player'})},Wallet:{filter:async()=>[{}]},PrivacyPolicyConfig:{filter:async()=>[]},EmailLog:{create:async()=>{}},Match:{filter:async()=>{throw Error('Must not read matches');}}},integrations:{Core:{SendEmail:async msg=>sent.push(msg)}}}};
const {exports}=await loadBackend('base44/shared/depositAvailableEmail.ts',{
'./emailTemplate.ts':{buildChessBetEmailHtml:x=>JSON.stringify(x)},
'./seamlessAtomicStore.ts':{claimWebhookEvent:async()=>({claim:'owned'}),finishWebhookEvent:async()=>{}},
'./integrationEvents.ts':{recordIntegrationEvent:async()=>{}}});
assert.equal((await exports.sendDepositAvailableEmail(emailBase,notification)).sent,true);
const html=JSON.parse(sent[0].body);assert.equal(html.ctaText,'Start Playing');assert.equal(html.ctaUrl,'https://worldchessbet.com/play');assert.ok(html.bodyHtml.split(/\s+/).length<80);assert.doesNotMatch(html.bodyHtml,/jenbaybe|available balance|Transaction ID|reserved|withdrawal/i);
await exports.sendDepositAvailableEmail(emailBase,notification);assert.equal(sent.length,1);
console.log('Legacy repair is retired. Deposit email copy and duplicate suppression passed.');
