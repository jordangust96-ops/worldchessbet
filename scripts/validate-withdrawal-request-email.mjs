import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
import {bankBusinessDaysAfter} from '../base44/shared/depositTiming.js';
let tx={id:'w',type:'withdrawal',user_id:'user',amount:9.25,withdrawal_requested_at:'2026-09-14T12:00:00Z',withdrawal_estimated_arrival:'2026-09-23T20:00:00Z',withdrawal_request_status:'queued',withdrawal_request_email_status:'pending'};
let sent=[],fail=false,logs=[],claimed='owned';
const base={asServiceRole:{entities:{WalletTransaction:{get:async()=>({...tx}),update:async(id,p)=>Object.assign(tx,p)},User:{get:async()=>({email:'mock@example.invalid',full_name:'Player <test>'})},Wallet:{filter:async()=>[]},PrivacyPolicyConfig:{filter:async()=>[]},EmailLog:{create:async p=>logs.push(p)}},integrations:{Core:{SendEmail:async p=>{if(fail)throw Error('delivery failure');sent.push(p);}}}}};
const {exports}=await loadBackend('base44/shared/withdrawalRequestedEmail.ts',{
'./emailTemplate.ts':{buildChessBetEmailHtml:x=>JSON.stringify(x)},
'./seamlessAtomicStore.ts':{claimWebhookEvent:async()=>({claim:claimed}),finishWebhookEvent:async(a,b,c,state)=>{claimed=state==='completed'?'completed':'owned';}},
'./integrationEvents.ts':{recordIntegrationEvent:async()=>{}}});
tx.withdrawal_request_status='preparing';assert.equal((await exports.sendWithdrawalRequestedEmail(base,tx)).skipped,true);assert.equal(sent.length,0);
tx.withdrawal_request_status='queued';fail=true;assert.equal((await exports.sendWithdrawalRequestedEmail(base,tx)).failed,true);assert.equal(tx.withdrawal_request_email_status,'failed');assert.equal(logs[0].email_type,'withdrawal_requested');
fail=false;assert.equal((await exports.sendWithdrawalRequestedEmail(base,tx)).sent,true);assert.equal(sent.length,1);
const html=JSON.parse(sent[0].body);assert.equal(html.ctaUrl,'https://worldchessbet.com/wallet');assert.match(html.bodyHtml,/September 23, 2026/);assert.match(html.bodyHtml,/Estimated arrival/);assert.match(html.bodyHtml,/estimate/);assert.doesNotMatch(html.bodyHtml,/hold|cushion|Seamless fee|challenge/i);assert.ok(html.bodyHtml.split(/\s+/).length<90);
await exports.sendWithdrawalRequestedEmail(base,tx);assert.equal(sent.length,1);
assert.equal(bankBusinessDaysAfter('2026-09-04T12:00:00Z',1),'2026-09-08T12:00:00.000Z');
assert.equal(bankBusinessDaysAfter('2026-11-25T12:00:00Z',1),'2026-11-27T12:00:00.000Z');
console.log('Withdrawal email: confirmed request, date, concise copy, failure retry, duplicate suppression and holiday estimates passed. No customer email sent.');
