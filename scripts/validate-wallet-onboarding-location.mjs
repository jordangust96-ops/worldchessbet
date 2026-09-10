import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadBackend} from './helpers/load-backend.mjs';
const {exports:location} = await loadBackend('base44/shared/walletOnboardingLocation.ts');
const evidence = (patch={}) => ({user_id:'u',provider:'MaxMind',verification_result:'approved',
 pre_bypass_verification_result:'approved',geolocation_enforcement_enabled:true,enforcement_bypassed:false,
 vpn_or_proxy_detected:false,ip_address:'192.0.2.1',detected_country:'US',detected_state:'GA',
 trigger_event:'wallet_onboarding',verified_at:'2026-09-01T00:00:00.000Z',...patch});
assert.equal(location.isWalletLocationEvidence(evidence(), 'u'),true);
for(const patch of [{user_id:'other'},{provider:'Other'},{verification_result:'blocked'},
 {pre_bypass_verification_result:'blocked'},{geolocation_enforcement_enabled:false},
 {enforcement_bypassed:true},{vpn_or_proxy_detected:true},{ip_address:''},{detected_country:'CA'},
 {detected_state:''},{verified_at:'bad'},{verified_at:'2999-01-01'},
 {trigger_event:'match_readiness',verified_at:'2026-09-10T23:33:00Z'}])
 assert.equal(location.isWalletLocationEvidence(evidence(patch),'u'),false,JSON.stringify(patch));
assert.equal(location.isWalletLocationEvidence(evidence({trigger_event:'deposit'}),'u'),true,'genuine old approval is retained');
function sdk(rows,user={id:'u',account_state:'provisional'}) {
 return {auth:{me:async()=>user},asServiceRole:{entities:{
 User:{get:async()=>user},JurisdictionVerificationLog:{filter:async q => rows.filter(r =>
 r.user_id===q.user_id && (!q.verification_result||r.verification_result===q.verification_result) &&
 (!q.trigger_event||r.trigger_event===q.trigger_event)).reverse()}
 }}};
}
for(const status of ['approved','blocked','verification_failed']) {
 let rows=[],calls=0,locks=0,releases=0;
 const client=sdk(rows);
 const {handler}=await loadBackend('base44/functions/verifyWalletOnboardingLocation/entry.ts',{
 'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>client},
 '../../shared/walletOnboardingLocation.ts':location,
 '../../shared/requestJurisdiction.ts':{getRequestJurisdiction:async(req,context,policy)=>{
 calls++;assert.equal(context.triggerEvent,'wallet_onboarding');
 assert.equal(policy.fresh,true);assert.equal(policy.requireLocation,true);
 assert.equal(req.headers.get('cf-connecting-ip'),'192.0.2.1');
 rows.push(evidence({verification_result:status,pre_bypass_verification_result:status}));
 return Response.json({status});}},
 '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>{locks++;return true;},releaseUserWalletLock:async()=>{releases++;}}
 });
 const request=()=>new Request('https://test.invalid',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1'},
 body:JSON.stringify({userId:'other',approved:true,state:'GA'})});
 let response=await handler(request());assert.equal(response.status,200);
 assert.equal((await response.json()).allowed,status==='approved');
 assert.equal(calls,1);assert.equal(locks,1);assert.equal(releases,1);
 // Reload and a later gameplay denial cannot erase onboarding approval.
 if(status==='approved'){
 rows.push(evidence({trigger_event:'match_readiness',verification_result:'blocked'}));
 assert.equal((await location.walletOnboardingLocation(client,'u')).allowed,true);
 assert.equal((await (await handler(request())).json()).allowed,true);
 assert.equal(calls,1,'approved users never re-check current location');assert.equal(locks,1);
 }
}
let geoCalls=0;
const {handler:anonymous}=await loadBackend('base44/functions/verifyWalletOnboardingLocation/entry.ts',{
 'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>sdk([],null)},
 '../../shared/walletOnboardingLocation.ts':location,
 '../../shared/requestJurisdiction.ts':{getRequestJurisdiction:async()=>{geoCalls++;}},
 '../../shared/seamlessAtomicStore.ts':{acquireUserWalletLock:async()=>true,releaseUserWalletLock:async()=>{}}
});
assert.equal((await anonymous(new Request('https://test.invalid',{method:'POST'}))).status,401);
assert.equal(geoCalls,0);
for(const path of ['base44/functions/startSocureIdentityVerification/entry.ts','base44/functions/submitSeamlessDeposit/entry.ts','base44/shared/bankOnboardingEligibility.ts']){
 const src=fs.readFileSync(path,'utf8');
 assert.ok(src.includes('walletOnboardingLocation('),path);
 assert.ok(!src.includes('getRequestJurisdiction'),path+' never looks up current location');
}
assert.ok(!fs.readFileSync('src/components/wallet/SeamlessPlaidBankLink.jsx','utf8').includes('getCurrentJurisdiction'), 'bank UI never repeats location check');
const panel=fs.readFileSync('src/components/wallet/SeamlessFundingPanel.jsx','utf8');
assert.ok(panel.includes('state?.onboarding_location?.allowed'));
assert.ok(!panel.includes('{journey.message}'));
const step=fs.readFileSync('src/components/wallet/DepositLocationStep.jsx','utf8');
assert.ok(!/pending deposit|deposit pending|another deposit/i.test(step.replace(/\/\/[^\n]*/g,'')));
assert.ok(!/getCurrentJurisdiction|getJurisdictionCheck|useEffect/.test(step));
console.log('One-time wallet location: trusted legacy evidence, permanent approval, denied/error states, spoof refusal, no rechecks after approval, separate gameplay, and concise UI passed.');
