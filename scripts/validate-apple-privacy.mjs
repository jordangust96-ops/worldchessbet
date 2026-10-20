import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {accountDeletionAction} from '../base44/shared/accountDeletion.js';
import {getDeviceFingerprintHash} from '../src/lib/deviceContext.js';
const now=new Date('2026-10-20T12:00:00Z');
const owner={id:'owner',email:'owner@example.test',role:'user'},other={id:'other',role:'user'},admin={id:'admin',role:'admin'};
let rows=[],missing=false,calls=[];
const store={
 forUser:async id=>{calls.push(['forUser',id]);return rows.filter(r=>r.user_id===id).reverse();},
 create:async d=>{const r={...d,id:'request-'+(rows.length+1)};rows.push(r);return r;},
 list:async(limit,skip)=>rows.slice(skip,skip+limit),
 get:async id=>rows.find(r=>r.id===id),
 update:async(id,d)=>{const r=rows.find(r=>r.id===id);Object.assign(r,d);return r;},
 authUserMissing:async()=>missing,
};
const run=(user,body={})=>accountDeletionAction({user,body,store,now});
assert.equal((await run(null)).status,401);
assert.equal((await run(owner,{action:'request',confirm:'no'})).status,400);assert.equal(rows.length,0);
let r=await run(owner,{action:'request',confirm:'DELETE MY ACCOUNT',userId:'other',contact_email:'attacker@example.test',status:'completed'});
assert.equal(r.status,200);assert.equal(rows[0].user_id,'owner');assert.equal(rows[0].contact_email,owner.email);assert.equal(rows[0].status,'requested');
assert.equal(r.body.request.contact_email,undefined);
await run(owner,{action:'request',confirm:'DELETE MY ACCOUNT'});assert.equal(rows.length,1,'retry reuses open request');
assert.equal((await run(other)).body.request,null,'request not exposed cross-user');
assert.equal((await run(other,{action:'list'})).status,403);
assert.equal((await run(owner,{action:'review',requestId:rows[0].id,status:'completed'})).status,403);
assert.equal((await run(admin,{action:'list',skip:-1})).status,400);
assert.equal((await run(admin,{action:'list'})).body.requests.length,1);
const complete={action:'review',requestId:rows[0].id,status:'completed',playerMessage:'Deletion completed after verified fulfillment.',retentionSummary:'Required records retained under reviewed obligations; review date documented in case.',completionReference:'privacy-case-1234: fulfillment and notice verified',appleAccessHandled:true,associatedDataHandled:true,confirmationSent:true};
assert.equal((await run(admin,complete)).status,409,'must review first');
assert.equal((await run(admin,{action:'review',requestId:rows[0].id,status:'in_review',playerMessage:'Support is reviewing the request.'})).status,200);
assert.equal((await run(admin,{...complete,associatedDataHandled:false})).status,409);
assert.equal((await run(admin,complete)).body.error,'authentication_record_still_exists');
store.authUserMissing=async()=>{throw new Error('provider unavailable');};
await assert.rejects(()=>run(admin,complete));assert.equal(rows[0].status,'in_review','outage is not absence');
store.authUserMissing=async()=>true;
assert.equal((await run(admin,complete)).status,200);
assert.equal(rows[0].completed_at,now.toISOString());
assert.equal((await run(admin,{action:'review',requestId:rows[0].id,status:'in_review',playerMessage:'Try to reopen completed request.'})).status,409);
// Fingerprint compatibility export must not access any browser/device property.
for(const name of ['navigator','window','screen','crypto','Intl']){
 Object.defineProperty(globalThis,name,{configurable:true,get(){throw new Error('Device property read: '+name);}});
}
assert.equal(await getDeviceFingerprintHash(),'');
const jurisdiction=await readFile(new URL('../base44/shared/requestJurisdiction.ts',import.meta.url),'utf8');
assert.doesNotMatch(jurisdiction,/device_fingerprint_hash\s*:/);
assert.doesNotMatch(jurisdiction,/body\?\.deviceFingerprintHash/);
for(const file of ['../src/lib/challengeApi.js','../src/components/play/matchview/PreparingMatchScreen.jsx']){
 assert.doesNotMatch(await readFile(new URL(file,import.meta.url),'utf8'),/getDeviceFingerprintHash|deviceFingerprintHash/);
}
const backend=await readFile(new URL('../base44/functions/manage-account-deletion/entry.ts',import.meta.url),'utf8');
assert.match(backend,/requireAdminMfa/);
assert.match(backend,/Number\(error\?\.status \|\| error\?\.response\?\.status\) === 404/);
assert.doesNotMatch(backend,/\.delete\(|closeAccount|submitSeamless|postLedgerLegs|account_state/);
const entity=JSON.parse(await readFile(new URL('../base44/entities/account-deletion-request.jsonc',import.meta.url),'utf8'));
assert.equal(entity.rls.create,false);assert.equal(entity.rls.update,false);assert.equal(entity.rls.delete,false);
console.log('Apple privacy/deletion validation passed: ownership, confirmation, retries, completion evidence, provider failure, RLS and no device reads.');
