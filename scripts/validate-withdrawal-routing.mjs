import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
import {buildWithdrawalBody} from '../base44/shared/seamlessAchPure.js';
let merchant, recipient, calls;
const reset=()=>{
 calls=[];
 merchant=[{source_id:'merchant-bank',user_id:'merchant',bank:'Business Bank',status:'verified',is_primary:true},{source_id:'merchant-balance',user_id:'merchant',bank:'Balance',status:'verified',is_primary:true}];
 recipient=[{source_id:'recipient-bank',user_id:'recipient',bank:'Recipient Bank',status:'verified',is_primary:true}];
};
reset();
const {exports:{buildVerifiedWithdrawalBody}}=await loadBackend('base44/shared/verifiedWithdrawalBody.ts',{
 './seamlessAch.ts':{PATH_ACCOUNT:'/account',buildWithdrawalBody,seamlessRequest:async(method,path)=>{
  calls.push({method,path});
  if(path==='/account')return {user_id:'merchant'};
  if(path==='/funding-source/user/:merchant')return {success:true,list:merchant};
  if(path==='/funding-source/user/:recipient')return {success:true,list:recipient};
  throw Error('Unexpected endpoint');
 }}
});
const input={providerUserId:'recipient',sourceId:'recipient-bank',name:'Test Player',amount:9.25,label:'test-withdrawal'};
const body=await buildVerifiedWithdrawalBody(input);
assert.equal(body.account,'merchant-balance');
assert.equal(body.recipient,'recipient');
assert.equal(body.amount,'9.25');
assert.equal(body.label,input.label);
assert.ok(calls.every(c=>c.method==='GET'));
assert.throws(()=>buildWithdrawalBody(input),/merchant sender/);
assert.throws(()=>buildWithdrawalBody({...input,senderSourceId:input.sourceId}),/merchant sender/);
for(const change of [
 ()=>recipient[0].source_id='different-bank',
 ()=>recipient[0].is_primary=false,
 ()=>recipient[0].status='unverified',
 ()=>recipient[0].user_id='someone-else',
 ()=>recipient.push({...recipient[0],source_id:'another-primary'}),
 ()=>merchant.splice(1,1),
 ()=>merchant[1].user_id='someone-else',
 ()=>merchant[1].status='unverified',
 ()=>merchant.push({...merchant[1],source_id:'another-balance'}),
]){
 reset();change();await assert.rejects(()=>buildVerifiedWithdrawalBody(input),/withdrawal_/);
}
console.log('16 verified payout routing assertions passed: merchant Balance only, saved recipient bank, no POST, reject changed/ambiguous/unverified account mappings.');
