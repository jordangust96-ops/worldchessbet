import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
import {buildWithdrawalBody} from '../base44/shared/seamlessAchPure.js';

// Verified Direct Credit routing: buildVerifiedWithdrawalBody validates ONLY
// ChessBet's locally persisted frozen destination and customer mapping. Zero
// provider funding-source list GETs before POST /ach/v2/check/send. This suite
// retires the undocumented recipient funding-source-list preflight and proves
// the documented contract: recipient, name, amount, description, label, plus
// account ONLY when a merchant sender source id is explicitly configured.

const TX='6ac0f3837594bd52f0055308';
const SOURCE='ace8a1d7-1c71-488d-ac4d-461012b5eb13';
let db, providerCalls, posts;
const matches=(row,q)=>Object.entries(q||{}).every(([k,v])=>row[k]===v);
const entities=new Proxy({}, {get:(_,name)=>({
  filter:async(q={},sort='-created_date',limit=2)=>{
    if(!Array.isArray(db[name]))return [];
    return structuredClone(db[name].filter(r=>matches(r,q)).slice(0,limit));
  },
  get:async id=>structuredClone((db[name]||[]).find(r=>r.id===id)||null),
})});
const client={asServiceRole:{entities}};

// No provider endpoint may be reached by buildVerifiedWithdrawalBody.
const provider=async()=>{throw Error('buildVerifiedWithdrawalBody must not call any provider endpoint');};

const {exports:{buildVerifiedWithdrawalBody,DEFINITE_DESTINATION_REASONS,isDefinitePreflightRejection}}=
  await loadBackend('base44/shared/verifiedWithdrawalBody.ts',{
    './seamlessAch.ts':{buildWithdrawalBody},
  });

const baseInput={base44:client,userId:'fixture-user',providerUserId:'customer',name:'Fixture Player',amount:9.25,description:'ChessBet withdrawal',label:'chessbet-withdrawal-'+TX,sourceId:SOURCE};

function bank(status,overrides={}){return {id:'local-bank',user_id:'fixture-user',source_id:SOURCE,provider_user_id:'customer',status,...overrides};}

function reset(){db={SeamlessBankAccount:[bank('verified',{is_primary:true})]};providerCalls=0;posts=0;}

// Verified local destination builds the documented body; no account, no provider GET.
reset();
const body=await buildVerifiedWithdrawalBody(baseInput);
assert.equal(body.recipient,'customer');
assert.equal(body.name,'Fixture Player');
assert.equal(body.amount,'9.25');
assert.equal(body.label,'chessbet-withdrawal-'+TX);
assert.equal(body.description,'ChessBet withdrawal');
assert.ok(!('account' in body),'account must be absent when no merchant sender is configured');
assert.ok(!('source_id' in body)&&!('funding_source_id' in body),'recipient funding_source_id must never be a body field');
assert.equal(providerCalls,0);

// account is included ONLY when an explicit merchant sender source id is provided.
reset();
const bodyWithAccount=await buildVerifiedWithdrawalBody({...baseInput,senderSourceId:'merchant-balance'});
assert.equal(bodyWithAccount.account,'merchant-balance');

// Never send the recipient funding_source_id as account.
reset();
await assert.rejects(()=>buildVerifiedWithdrawalBody({...baseInput,senderSourceId:SOURCE}),/merchant sender/);

// Credit-eligible statuses all pass with zero provider GET and zero POST.
for(const status of ['added','pending_verification','verified']){
  reset();db.SeamlessBankAccount[0].status=status;
  const ok=await buildVerifiedWithdrawalBody(baseInput);
  assert.equal(ok.recipient,'customer',`${status} should be credit-eligible`);
  assert.equal(providerCalls,0);
}

// Definitive local rejections — each has a precise, persisted reason and zero POST.
const rejections=[
  ['deleted',()=>db.SeamlessBankAccount[0].status='deleted','withdrawal_destination_deleted'],
  ['login_required',()=>db.SeamlessBankAccount[0].status='login_required','withdrawal_destination_reconnect_required'],
  ['error',()=>db.SeamlessBankAccount[0].status='error','withdrawal_destination_reconnect_required'],
  ['verification_failed',()=>db.SeamlessBankAccount[0].status='verification_failed','withdrawal_destination_reconnect_required'],
  ['verification_expired',()=>db.SeamlessBankAccount[0].status='verification_expired','withdrawal_destination_reconnect_required'],
  ['conflicting exact matches',()=>db.SeamlessBankAccount.push({...db.SeamlessBankAccount[0],id:'conflict',status:'deleted'}),'withdrawal_destination_multiple_primary'],
];
for(const [label,change,expected] of rejections){
  reset();change();
  let caught;
  try{await buildVerifiedWithdrawalBody(baseInput);}catch(e){caught=e;}
  assert.ok(caught,`expected rejection: ${label}`);
  assert.equal(caught.withdrawalReason,expected,`${label}: expected ${expected} got ${caught.withdrawalReason}`);
  assert.ok(DEFINITE_DESTINATION_REASONS.has(caught.withdrawalReason),`${label}: not in DEFINITE_DESTINATION_REASONS`);
  assert.ok(isDefinitePreflightRejection(caught),`${label}: isDefinitePreflightRejection should be true`);
  assert.equal(providerCalls,0,`${label}: zero provider calls`);
}

// Indeterminate local reads never reject and never POST.
const indeterminate=[
  ['local read throws',()=>{const e={entities:{SeamlessBankAccount:{filter:async()=>{throw Error('timeout')}}}};client.asServiceRole=e;}],
  ['page object not array',()=>{const e={entities:{SeamlessBankAccount:{filter:async()=>({items:db.SeamlessBankAccount,has_more:false})}}};client.asServiceRole=e;}],
  ['unknown status',()=>db.SeamlessBankAccount[0].status='some-unknown-status'],
  ['missing exact destination',()=>db.SeamlessBankAccount.splice(0)],
  ['wrong owner',()=>db.SeamlessBankAccount[0].user_id='someone-else'],
  ['missing customer mapping',()=>{baseInput.providerUserId='';}],
  ['customer mapping conflict',()=>db.SeamlessBankAccount[0].provider_user_id='different-customer'],
];
for(const [label,change] of indeterminate){
  reset();const originalEntities=client.asServiceRole;change();
  let caught;
  try{await buildVerifiedWithdrawalBody(baseInput);}catch(e){caught=e;}
  client.asServiceRole=originalEntities;baseInput.providerUserId='customer';
  assert.ok(caught,`${label}: expected indeterminate failure`);
  assert.equal(isDefinitePreflightRejection(caught),false,`${label}: must not be definitive`);
  assert.equal(caught.withdrawalIndeterminate,true,`${label}: must be indeterminate`);
  assert.equal(providerCalls,0,`${label}: zero provider calls`);
}

// description is truncated to 128 chars per the documented contract.
reset();
const longDesc='x'.repeat(200);
const bodyTrunc=await buildVerifiedWithdrawalBody({...baseInput,description:longDesc});
assert.equal(bodyTrunc.description.length,128,'description must be truncated to 128 chars');

console.log('Verified Direct Credit routing: local-only validation, zero provider GET, documented body, credit-eligible statuses, precise rejections, indeterminate reads never reject.');