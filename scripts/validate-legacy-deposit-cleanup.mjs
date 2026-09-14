import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
const TX='6aa1e4c979d0708fbf195281',USER='6a4ed72636c51cb3280d2bc7',REF='d8fabdf2-c67e-4dd5-89b0-901e7a52f1e3';
let tx={id:TX,user_id:USER,type:'deposit',amount:10,status:'completed',deposit_hold_status:'released',deposit_withdrawal_status:'held',deposit_release_at:'2026-09-16T22:59:21.815Z'};
let adjustments=[],batches=[],available=10,posts=0,denied=false,providerStatus='processed',claimState='owned',failUpdate=false;
const entities={WalletTransaction:{get:async()=>({...tx}),filter:async()=>adjustments,create:async x=>{const a={...x,id:'adjustment'};adjustments.push(a);return a;},update:async(id,p)=>{if(failUpdate){failUpdate=false;throw Error('interrupt');}Object.assign(adjustments[0],p);}},Wallet:{filter:async()=>[{available_balance:available,held_balance:0}]},LedgerJournalBatch:{filter:async()=>batches}};
const base={auth:{me:async()=>({id:USER,role:'admin'})},asServiceRole:{entities}};
const {handler}=await loadBackend('base44/functions/reconcileLegacyLaunchDeposit/entry.ts',{
'npm:@base44/sdk@0.8.48':{createClientFromRequest:()=>base},
'../../shared/mfa.ts':{requireAdminMfa:async()=>denied?Response.json({error:'mfa_required'},{status:401}):null},
'../../shared/seamlessAch.ts':{buildCheckLookupPath:x=>x,seamlessRequest:async()=>({check:{check_id:REF,amount:10,status:providerStatus}})},
'../../shared/seamlessAtomicStore.ts':{claimWebhookEvent:async()=>({claim:claimState}),finishWebhookEvent:async(a,b,c,s)=>{claimState=s==='completed'?'completed':'owned';}},
'../../shared/ledger.ts':{postLedgerLegs:async(base,args)=>{await args.beforePost();assert.equal(Math.round(args.legs.reduce((s,l)=>s+l.debit-l.credit,0)*100),0);assert.equal(args.updateTransactions,false);if(!batches.length){batches.push({id:'batch'});available-=args.legs[0].debit;posts++;}}}});
const call=async commit=>handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({commit})}));
assert.equal((await call(false)).status,200);assert.equal(adjustments.length,0);
denied=true;assert.equal((await call(true)).status,401);denied=false;
providerStatus='pending';assert.equal((await call(true)).status,409);assert.equal(posts,0);providerStatus='processed';
available=9;assert.equal((await call(true)).status,409);assert.equal(posts,0);available=10;
failUpdate=true;assert.equal((await call(true)).status,409);assert.equal(available,9.25);
assert.equal((await call(true)).status,200);assert.equal(posts,1);assert.equal(adjustments.length,1);assert.equal(adjustments[0].status,'completed');
assert.equal((await call(true)).status,200);assert.equal(posts,1);
assert.equal(tx.amount,10);assert.equal(tx.deposit_withdrawal_status,'held');assert.equal(tx.deposit_release_at,'2026-09-16T22:59:21.815Z');
let sent=[],notification={id:'new',user_id:'test',type:'deposit',amount:20,status:'completed',deposit_hold_status:'released'};
const emailBase={asServiceRole:{entities:{WalletTransaction:{get:async()=>notification,update:async(id,p)=>Object.assign(notification,p)},User:{get:async()=>({email:'mock@example.invalid',full_name:'Player'})},Wallet:{filter:async()=>[{}]},PrivacyPolicyConfig:{filter:async()=>[]},EmailLog:{create:async()=>{}},Match:{filter:async()=>{throw Error('Must not read matches');}}},integrations:{Core:{SendEmail:async msg=>sent.push(msg)}}}};
const {exports}=await loadBackend('base44/shared/depositAvailableEmail.ts',{
'./emailTemplate.ts':{buildChessBetEmailHtml:x=>JSON.stringify(x)},
'./seamlessAtomicStore.ts':{claimWebhookEvent:async()=>({claim:'owned'}),finishWebhookEvent:async()=>{}},
'./integrationEvents.ts':{recordIntegrationEvent:async()=>{}}});
assert.equal((await exports.sendDepositAvailableEmail(emailBase,notification)).sent,true);
const html=JSON.parse(sent[0].body);assert.equal(html.ctaText,'Start Playing');assert.equal(html.ctaUrl,'https://worldchessbet.com/play');assert.ok(html.bodyHtml.split(/\s+/).length<80);assert.doesNotMatch(html.bodyHtml,/jenbaybe|available balance|Transaction ID|reserved|withdrawal/i);
await exports.sendDepositAvailableEmail(emailBase,notification);assert.equal(sent.length,1);
console.log('Legacy adjustment: authorization, provider check, changed balance, interruption repair and idempotency passed. Email: short generic copy and duplicate suppression passed.');
