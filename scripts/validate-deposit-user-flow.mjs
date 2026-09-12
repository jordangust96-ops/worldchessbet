import * as pricing from '../base44/shared/depositPricing.js';
import assert from 'node:assert/strict';
import {loadBackend} from './helpers/load-backend.mjs';
import * as ages from '../base44/shared/playerAgePolicy.js';
import * as gates from '../base44/shared/jurisdictionGates.js';
import * as regions from '../base44/shared/jurisdictionRegions.js';
const ip='203.0.113.10';
async function depositHarness({verified=true,hold=false,location='approved',bankVerified=true,primaryChanges=false,outcome='accepted',admin=false}={}){
 let user={id:'u1',role:admin?'admin':'user',account_state:'verified',withdrawal_hold:hold,identity_age_verified:verified,identity_age_over_21:verified};
 let bankReads=0,calls=0,created=0,geoCalls=0,op=null,tx=null;
 const sdk={auth:{me:async()=>user},asServiceRole:{entities:{
  User:{get:async()=>user},
  SeamlessBankAccount:{filter:async()=>{bankReads++;return bankVerified?[{source_id:primaryChanges&&bankReads>1?'bank2':'bank1',is_primary:true}]:[];}},
  SeamlessPaymentProfile:{filter:async()=>[{provider_user_id:'customer1'}]},
  WalletTransaction:{get:async()=>tx,create:async p=>{created++;return tx={id:'tx1',...p};},update:async(id,p)=>tx={...tx,...p}},
  IntegrationReference:{filter:async()=>[],create:async()=>({id:'ref1'})}
 }}};
 const {handler}=await loadBackend('base44/functions/submitSeamlessDeposit/entry.ts',{
 'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk},
 '../../shared/depositPricing.js':pricing,
 '../../shared/seamlessFundingConfig.ts':{seamlessDepositsEnabled:()=>true},
 '../../shared/complianceEvidence.ts':{extendComplianceEvidenceRetention:async()=>({authorization_id:'auth1'})},
 '../../shared/playerAgePolicy.js':ages,
 '../../shared/identityEligibility.js':{hasVerifiedIdentity:async()=>verified},
 '../../shared/legalName.ts':{legalNameFromUser:()=>({fullName:'Test Player'})},
 '../../shared/walletOnboardingLocation.ts':{walletOnboardingLocation:async()=>({allowed:location==='approved'})},
 '../../shared/seamlessAch.ts':{seamlessConfig:()=>({}),seamlessBaseUrl:()=>'',buildDepositBody:p=>p,PATH_ACH_DEBIT:'/ach-debit',SEAMLESS_PROVIDER_KEY:'seamless',userSafeTransferFailureReason:()=> 'Bank declined the deposit.',seamlessRequest:async()=>{calls++;if(outcome==='declined')throw {status:400};if(outcome==='timeout')throw {status:503};return {check_id:'check1'};}},
 '../../shared/integrationEvents.ts':{recordIntegrationEvent:async()=>{}},
 '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>true,releaseUserWalletLock:async()=>{},claimDepositOperation:async(id,key,amount)=>op||{amount,state:'new'},saveDepositOperation:async(id,key,p)=>op=p}
 });
 return {send:(amount=10)=>handler(new Request('https://test.invalid/deposit',{method:'POST',headers:{'true-client-ip':ip},body:JSON.stringify({amount,depositPricingVersion:pricing.depositQuote(amount)?.version,authorizedBankDebit:pricing.depositQuote(amount)?.bankDebit,idempotencyKey:'deposit-test-key-123',bankSourceId:'bank1'})})),state:()=>({calls,created,geoCalls,op,tx})};
}
for(const opts of [{verified:false},{hold:true},{location:'blocked'},{location:'unknown'},{location:'verification_failed'},{bankVerified:false},{primaryChanges:true}]){
 const h=await depositHarness(opts);assert.ok((await h.send()).status>=400);assert.equal(h.state().calls,0,JSON.stringify(opts)+' never reaches provider');
}
for(const amount of [0,9.99,10000.01,10.001,'bad',null]){
 const h=await depositHarness();assert.equal((await h.send(amount)).status,400);assert.equal(h.state().calls,0);
}
let h=await depositHarness();let r=await h.send();assert.equal(r.status,200);assert.equal((await r.json()).status,'pending');assert.equal(h.state().tx.status,'pending');assert.equal(h.state().calls,1);assert.equal(h.state().geoCalls,0,'deposit never checks current location');
await h.send();assert.equal(h.state().calls,1,'retry never sends another debit');assert.equal(h.state().created,1);
h=await depositHarness({outcome:'declined'});r=await h.send();assert.equal(r.status,400);assert.equal((await r.json()).request_terminal,true);assert.equal(h.state().tx.status,'failed');assert.match(h.state().tx.description,/Bank declined/);
h=await depositHarness({outcome:'timeout'});assert.equal((await h.send()).status,202);assert.equal((await h.send()).status,202);assert.equal(h.state().calls,1);assert.equal(h.state().tx.status,'pending');
h=await depositHarness({admin:true});assert.equal((await h.send()).status,200,'existing admin location policy still requires verified 21+ KYC');
h=await depositHarness({admin:true,verified:false});assert.equal((await h.send()).status,403);
const cache={country_confidence:99,subdivision_confidence:99,accuracy_radius_km:5,vpn_or_proxy_detected:false,user_id:'u1',ip_address:ip,provider:'MaxMind',geolocation_enforcement_enabled:true,enforcement_bypassed:false,verification_result:'approved',detected_country:'US',detected_state:'TX',verified_at:new Date().toISOString()};
const geoSdk={auth:{me:async()=>({id:'u1',role:'user'})},asServiceRole:{entities:{User:{update:async()=>{}},JurisdictionVerificationLog:{filter:async()=>[cache],create:async()=>{}}}}};
const {exports:geo}=await loadBackend('base44/shared/requestJurisdiction.ts',{
 'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>geoSdk},
 './jurisdictionGates.js':gates,'./jurisdictionRegions.js':regions
},{MAXMIND_GEOIP_ENABLED:'true'});
r=await geo.getRequestJurisdiction(new Request('https://test.invalid',{headers:{'true-client-ip':ip}}),{triggerEvent:'deposit'});
assert.equal((await r.json()).status,'approved');
r=await geo.getRequestJurisdiction(new Request('https://test.invalid',{headers:{'x-forwarded-for':ip}}),{triggerEvent:'deposit',ip});
assert.equal((await r.json()).status,'unknown','body/XFF cannot impersonate trusted edge IP');
async function bankGate({verified=true,hold=false,balance=0,approved=false}={}){
 const {exports}=await loadBackend('base44/shared/bankOnboardingEligibility.ts',{
 './identityEligibility.js':{hasVerifiedIdentity:async()=>verified},
 './walletOnboardingLocation.ts':{walletOnboardingLocation:async()=>({allowed:approved})}
 });
 return exports.bankOnboardingEligibility(new Request('https://test.invalid'),{asServiceRole:{entities:{User:{get:async()=>({id:'u1',withdrawal_hold:hold})},Wallet:{filter:async()=>[{available_balance:balance}]}}}},{id:'u1'});
}
assert.ok(await bankGate({verified:false,approved:true}));
assert.ok(await bankGate({hold:true,approved:true}));
assert.ok(await bankGate());
assert.equal(await bankGate({approved:true}),null);
assert.equal(await bankGate({balance:5}),null,'existing funds remain withdrawable from blocked locations');
console.log('Deposit user flow passed: saved onboarding approval, missing onboarding approval, KYC/21+, holds, primary-bank races, amounts, accepted/declined/uncertain outcomes, duplicate retry and withdrawal-preserving bank gate.');
