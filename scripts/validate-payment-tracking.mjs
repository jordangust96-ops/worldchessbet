import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPaymentReport, providerObservation, reportCsv, money, text } from '../base44/shared/seamlessPaymentReport.js';
let checks = 0;
const ok = v => { assert.ok(v); checks++; };
const eq = (a,b) => { assert.deepEqual(a,b); checks++; };
const tx = {id:'tx1',type:'deposit',user_id:'u1',amount:10,deposit_bank_debit:10.75,deposit_processing_fee:0.75,status:'completed',integration_status:'settled',funding_source_id:'bank1'};
const refs = [{provider_key:'seamless_ach',wallet_transaction_id:'tx1',external_reference_id:'chessbet-deposit-tx1',status:'submitting',user_id:'u1'},
{provider_key:'seamless_ach',wallet_transaction_id:'tx1',external_reference_id:'provider1',status:'completed',user_id:'u1'}];
const inputs = {transactions:[tx,{id:'bonus',type:'deposit',amount:500,source_event:'early_access_bonus'}],references:refs,
banks:[{source_id:'bank1',user_id:'u1',provider_user_id:'customer1',account_mask:'1234'}],profiles:[{user_id:'u1',provider_user_id:'customer1'}]};
const [row] = buildPaymentReport(inputs);
eq(buildPaymentReport(inputs).length,1);
eq(row.provider_reference_id,'provider1'); eq(row.label,'chessbet-deposit-tx1'); eq(row.bank_last_four,'1234');
ok(row.flags.includes('reference_snapshot_stale')); ok(row.flags.includes('net_settlement_unverified'));
eq(row.net_received,null); eq(row.processing_fee,null);
eq(buildPaymentReport({...inputs,banks:[{...inputs.banks[0],account_mask:'123456789'}]})[0].bank_last_four,'');
eq(money(null),null); eq(money(''),null); eq(money('10.75'),10.75); eq(money('0.012'),null);
const shared = buildPaymentReport({...inputs,transactions:[tx,{...tx,id:'tx2'}],references:[...refs,{...refs[1],wallet_transaction_id:'tx2'}]});
ok(shared.every(r=>r.flags.includes('provider_id_reused')));
const orphan = buildPaymentReport({references:refs}); eq(orphan.length,1);ok(orphan[0].flags.includes('missing_wallet_transaction'));
const e = {id:'event1',aggregate_id:'treasury1',amount:0.5,status:'pending',occurred_at:'2026-09-10T01:00:00Z',event_data_json:JSON.stringify({provider_ref:'treasury1',description:'Transfer to Balance'})};
const treasury = buildPaymentReport({events:[e,{...e,id:'event2',status:'processed',occurred_at:'2026-09-10T02:00:00Z'},{...e,id:'event3',status:'processed',occurred_at:'2026-09-10T02:00:00Z'}]});
eq(treasury.length,1);eq(treasury[0].status,'processed');eq(treasury[0].principal,null);ok(treasury[0].flags.includes('provider_amount_unverified'));
eq(buildPaymentReport({events:[{...e,event_data_json:JSON.stringify({description:'Daily Fees 09/10/26'})}]})[0].category,'provider_charge');
const response = {check:{check_id:'provider1',number:10006,amount:'10.75',status:'processed',label:'chessbet-deposit-tx1',bank_account_number:'NEVER_EXPORT',fee:0}};
const observed = providerObservation(response,row);
eq(observed.dashboard_number,'10006');eq(observed.provider_amount,10.75);eq(observed.flags,[]);ok(!JSON.stringify(observed).includes('NEVER_EXPORT'));ok(!('processing_fee' in observed));
assert.throws(()=>providerObservation({check:{...response.check,check_id:'wrong'}},row));checks++;
assert.throws(()=>providerObservation({check:{...response.check,currency:'EUR'}},row));checks++;
ok(providerObservation({check:{...response.check,amount:50}},row).flags.includes('provider_amount_mismatch'));
ok(providerObservation({check:{...response.check,label:'wrong'}},row).flags.includes('provider_label_mismatch'));
const csv = reportCsv([{id:'=1+1',description:' \t@evil',bank:'"quoted"'}]);
ok(csv.includes("'=1+1"));ok(csv.includes("' \t@evil"));ok(csv.includes('""quoted""'));
const original = JSON.stringify(inputs);buildPaymentReport(inputs);eq(JSON.stringify(inputs),original);

// Exercise deployed handler shape with fake entities and the real MFA guard.
// No provider network calls, no payment submission, no production mutations.
const handlerSource = readFileSync(new URL('../base44/functions/getSeamlessPaymentReport/entry.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const mfaSource = readFileSync(new URL('../base44/shared/mfa.ts',import.meta.url),'utf8').replace('export async function','async function');
let data = {}, writes = [], reads = 0, providerCalls = [], user = {id:'admin',role:'admin',mfa_bypass:true};
const entities = new Proxy({}, {get:(_,name)=>({
  filter:async(q,sort,limit,skip=0)=>{reads++;return (data[name]||[]).slice(skip,skip+limit);},
  create:async(fields)=>{writes.push({entity:name,fields});return fields;}
})});
const client = {auth:{me:async()=>user},asServiceRole:{entities}};
let handler;
new Function('createClientFromRequest','buildPaymentReport','providerObservation','text','seamlessRequest','buildCheckLookupPath','Deno',
mfaSource+'\n'+handlerSource)(()=>client,buildPaymentReport,providerObservation,text,
async(method,path)=>{providerCalls.push({method,path});return response;},id=>'/check/:'+id,{serve:h=>{handler=h;}});
const call = body => handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
user=null;eq((await call({})).status,401);eq(reads,0);
user={role:'user'};eq((await call({})).status,403);eq(reads,0);
user={role:'admin'};eq((await call({})).status,401);eq(reads,0);
user={id:'admin',role:'admin',mfa_bypass:true};
data={WalletTransaction:inputs.transactions,IntegrationReference:refs,SeamlessBankAccount:inputs.banks,SeamlessPaymentProfile:inputs.profiles};
let result=await call({action:'list'});eq(result.status,200);eq((await result.json()).rows.length,1);eq(writes.length,0);eq(providerCalls.length,0);
result=await call({action:'refresh_provider',provider_reference_id:'unknown'});eq(result.status,400);eq(providerCalls.length,0);
result=await call({action:'refresh_provider',provider_reference_id:'provider1'});eq(result.status,200);eq(providerCalls,[{method:'GET',path:'/check/:provider1'}]);
eq(writes.length,1);eq(writes[0].entity,'SeamlessPaymentObservation');ok(!('flags' in writes[0].fields));
data.SeamlessPaymentObservation=[{id:'o1',...writes[0].fields}];
result=await call({action:'list'});eq((await result.json()).rows[0].dashboard_number,'10006');
data.WalletTransaction=Array.from({length:501},(_,i)=>({...tx,id:'tx'+i}));result=await call({action:'list'});eq(result.status,200);
data.WalletTransaction=[tx,tx];result=await call({action:'list'});eq(result.status,503);
const schema=JSON.parse(readFileSync(new URL('../base44/entities/seamless-payment-observation.jsonc',import.meta.url),'utf8'));
eq(schema.rls,{read:{user_condition:{role:'admin'}},create:false,update:false,delete:false});
console.log('Payment tracking: '+checks+' assertions passed');
