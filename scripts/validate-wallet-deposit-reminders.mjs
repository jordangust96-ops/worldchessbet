import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {reminderEligibility,buildWalletDepositReminder,REMINDER_CAMPAIGN,REMINDER_SUBJECT,WAIT_MS,CHESSBET_LOGO_URL} from '../base44/shared/walletDepositReminder.js';
let checks=0; const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const now=Date.now();
const at=offset=>new Date(now+offset).toISOString();
const base={
 user:{id:'u1',email:'player@example.invalid',full_name:'A & B',account_state:'verified',marketing_unsubscribe_token:'preview-token-12345678901234567890'},
 banks:[{id:'b1',user_id:'u1',source_id:'bank1',status:'verified',verified_at:at(-WAIT_MS)}],
 wallets:[{id:'w1',user_id:'u1',balance:0,available_balance:0,held_balance:0,total_balance:0,total_deposited:0}],
 deposits:[],deliveries:[]
};
eq(reminderEligibility(base,now).eligible,true);
eq(reminderEligibility(base,now-1).eligible,false);
eq(reminderEligibility({...base,user:{...base.user,marketing_email_opt_out:true}},now).eligible,false);
eq(reminderEligibility({...base,user:{...base.user,account_state:'closed'}},now).eligible,false);
eq(reminderEligibility({...base,banks:[{...base.banks[0],status:'deleted'}]},now).eligible,false);
eq(reminderEligibility({...base,banks:[{...base.banks[0],verified_at:null}]},now).eligible,false);
eq(reminderEligibility({...base,wallets:[]},now).eligible,false);
eq(reminderEligibility({...base,wallets:[{...base.wallets[0],held_balance:10}]},now).eligible,false);
eq(reminderEligibility({...base,wallets:[{...base.wallets[0],total_deposited:10}]},now).eligible,false);
eq(reminderEligibility({...base,deliveries:[{status:'sending'}]},now).eligible,false);
eq(reminderEligibility({...base,deliveries:[{status:'failed'}]},now).eligible,false);
const tx={id:'d1',user_id:'u1',type:'deposit',launch_epoch:2,created_date:at(-WAIT_MS-1),status:'pending',integration_status:'submitted'};
for(const status of ['pending','processing','review_required','completed','reversed']) {
 eq(reminderEligibility({...base,deposits:[{...tx,status}]},now).eligible,false);
}
eq(reminderEligibility({...base,deposits:[{...tx,status:'failed',integration_status:'failed',processed_at:at(-WAIT_MS+1000)}]},now).eligible,false);
eq(reminderEligibility({...base,deposits:[{...tx,status:'failed',integration_status:'failed',processed_at:at(-WAIT_MS)}]},now).eligible,true);
eq(reminderEligibility({...base,deposits:[{...tx,status:'failed',integration_status:'uncertain'}]},now).eligible,false);
eq(reminderEligibility({...base,deposits:[{...tx,launch_epoch:undefined,status:'completed',source_event:'early_access_bonus'}]},now).eligible,true);
eq(reminderEligibility({...base,banks:[...base.banks,{...base.banks[0],id:'b2',source_id:'bank2',verified_at:at(0)}]},now).eligible,true);
const html=buildWalletDepositReminder({firstName:'A & <B>',unsubscribeUrl:'https://worldchessbet.com/unsubscribe?userId=preview&token=invalid-preview-token-1234567890'});
assert.ok(html.includes(CHESSBET_LOGO_URL));checks++;
assert.ok(html.includes('A &amp; &lt;B&gt;'));checks++;
assert.ok(html.includes('>Unsubscribe</a>'));checks++;
assert.ok(html.includes('https://worldchessbet.com/wallet'));checks++;
assert.ok(html.includes('deposit clears'));checks++;
assert.doesNotMatch(html+REMINDER_SUBJECT,/early.access|<svg|\p{Extended_Pictographic}/u);checks++;
assert.equal((html.match(/<table\b/g)||[]).length,(html.match(/<\/table>/g)||[]).length);checks++;

const source=fs.readFileSync('base44/functions/processWalletDepositReminders/entry.ts','utf8').replace(/^import .*;\n/gm,'');
function system({sendThrows=false,auditThrows=false,optOut=false,busy=false}={}) {
 const data=structuredClone(base);data.user.marketing_email_opt_out=optOut;
 data.banks[0].verified_at=at(-WAIT_MS-60000);
 const sent=[],logs=[]; let caller={role:'admin'},handler,lock=busy?'busy':null,sequence=0;
 const arrays={SeamlessBankAccount:data.banks,Wallet:data.wallets,WalletTransaction:data.deposits,CampaignDelivery:data.deliveries,PrivacyPolicyConfig:[]};
 const entities={User:{get:async()=>structuredClone(data.user),update:async(id,patch)=>Object.assign(data.user,patch)},CampaignEmailLog:{create:async x=>{if(auditThrows)throw Error('audit');logs.push(x);}}};
 for(const [name,rows] of Object.entries(arrays)) entities[name]={
  filter:async(query,sort,limit=500,skip=0)=>rows.filter(row=>Object.entries(query).every(([k,v])=>row[k]===v)).slice(skip,skip+limit).map(row=>({...row})),
  create:async x=>{const row={...x,id:'row'+(++sequence)};rows.push(row);return {...row};},
  update:async(id,patch)=>Object.assign(rows.find(row=>row.id===id),patch)
 };
 const client={auth:{me:async()=>caller},asServiceRole:{entities,integrations:{Core:{SendEmail:async x=>{sent.push(x);if(sendThrows)throw Error('response lost');}}}}};
 const ctx=vm.createContext({
  createClientFromRequest:()=>client,claimWebhookEvent:async()=>{if(lock)return {claim:lock};lock='busy';return {claim:'owned'};},
  finishWebhookEvent:async(k,p,o,state)=>{lock=state==='completed'?'completed':null;},
  hasVerifiedIdentity:async()=>true,walletOnboardingLocation:async()=>({allowed:true}),
  paidContestsEnabled:()=>true,seamlessDepositsEnabled:()=>true,
  REMINDER_CAMPAIGN,REMINDER_SUBJECT,reminderEligibility,buildWalletDepositReminder,
  Deno:{serve:fn=>handler=fn},Response,Date,Set,Map,crypto,console:{error:()=>{}},
 });
 vm.runInContext(source,ctx);
 return {data,sent,logs,ctx,setCaller:v=>caller=v,run:async body=>handler({json:async()=>body||{}})};
}
let s=system();let response=await s.run();eq(response.status,200);eq((await response.json()).due,1);eq(s.sent.length,0);eq(s.data.deliveries.length,0);
s=system();await Promise.all([s.run({dryRun:false}),s.run({dryRun:false})]);eq(s.sent.length,1);eq(s.data.deliveries.length,1);
await s.run({dryRun:false});eq(s.sent.length,1);eq(s.data.deliveries[0].status,'success');
for(const failure of [{sendThrows:true},{auditThrows:true}]) {s=system(failure);await s.run({dryRun:false});await s.run({dryRun:false});eq(s.sent.length,1);}
s=system({optOut:true});await s.run({dryRun:false});eq(s.sent.length,0);
s=system({busy:true});await s.run({dryRun:false});eq(s.sent.length,0);
s=system();s.setCaller(null);eq((await s.run({dryRun:false})).status,401);eq(s.sent.length,0);
s.setCaller({role:'user'});eq((await s.run({dryRun:false})).status,403);
s=system();s.ctx.seamlessDepositsEnabled=()=>false;eq((await (await s.run({dryRun:false})).json()).paused_reason,'deposits_or_paid_play_disabled');eq(s.sent.length,0);
s=system();s.ctx.hasVerifiedIdentity=async()=>false;await s.run({dryRun:false});eq(s.sent.length,0);
s=system();s.ctx.walletOnboardingLocation=async()=>({allowed:false});await s.run({dryRun:false});eq(s.sent.length,0);
s=system();s.data.user.marketing_unsubscribe_token='';await s.run({dryRun:false});assert.ok(s.data.user.marketing_unsubscribe_token.length>=20);checks++;eq(s.sent.length,1);
fs.mkdirSync('/tmp/wallet-reminder-preview',{recursive:true});
fs.writeFileSync('/tmp/wallet-reminder-preview/index.html',html);
console.log('PASS: '+checks+' reminder checks; all email/data services mocked. No real emails sent.');
