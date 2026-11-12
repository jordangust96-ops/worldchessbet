import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
import {withChallengeReadBackoff} from '../base44/shared/challengeReadBackoff.js';

// Interrupt a projection read AFTER the creator journal commits, as in production.
for (const target of ['LedgerJournalBatch','WalletTransaction']) {
 const f=fixture(); let failed=false; const waits=[];
 const raw={...f.sdk,asServiceRole:{...f.sdk.asServiceRole,entities:new Proxy(f.sdk.asServiceRole.entities,{get(entities,name){
  const entity=entities[name]; return {...entity,filter:async(...args)=>{
   if(name===target && !failed && (target==='LedgerJournalBatch'||f.table('LedgerJournalBatch').length)){
    failed=true;throw Error('Rate limit exceeded: entity_list allows 140 requests per 60s. Retry after 1s.');
   }
   return entity.filter(...args);
  }};
 }})}};
 const sdk=withChallengeReadBackoff(raw,async ms=>waits.push(ms));
 const result=await f.api.createChallenge(sdk,f.user('p1'),{creationVersion:f.policy.CHALLENGE_CREATION_VERSION,serviceFee:2,entryAmount:25,requestKey:'read_throttle_creation'});
 assert.equal(failed,true);assert.deepEqual(waits,[2000]);
 assert.equal(result.match.challenge_operation_state,'idle');
 assert.equal(result.match.player1_deposited,true);
 assert.equal(f.table('LedgerJournalBatch').length,1);
 assert.equal(f.table('Wallet').find(w=>w.user_id==='p1').available_balance,73);
 await f.api.createChallenge(sdk,f.user('p1'),{creationVersion:f.policy.CHALLENGE_CREATION_VERSION,serviceFee:2,entryAmount:25,requestKey:'read_throttle_creation'});
 assert.equal(f.table('LedgerJournalBatch').length,1);
 console.log('PASS creation recovers throttled '+target+' read, one reservation');
}
for(const method of ['create','update','get','filter']){
 let calls=0,waits=0;
 const message=method==='filter'?'network interrupted':'Rate limit exceeded: entity_list. Retry after 1s.';
 const sdk=withChallengeReadBackoff({asServiceRole:{entities:{Match:{[method]:async()=>{calls++;throw Error(message);}}}}},async()=>waits++);
 await assert.rejects(()=>sdk.asServiceRole.entities.Match[method](),new RegExp(message.replaceAll('.','\\.')));
 assert.equal(calls,1);assert.equal(waits,0);
}
let calls=0;const waits=[];
const sdk=withChallengeReadBackoff({asServiceRole:{entities:{Match:{filter:async()=>{calls++;throw Error('Rate limit exceeded: entity_list. Retry after 1s.');}}}}},async ms=>waits.push(ms));
await assert.rejects(()=>sdk.asServiceRole.entities.Match.filter());
assert.equal(calls,3);assert.deepEqual(waits,[2000,2000]);
console.log('PASS bounded retries; no write, get or ambiguous-error replay');
