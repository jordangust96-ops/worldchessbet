import { createClientFromRequest } from "npm:@base44/sdk";
const HASH="71715476b25b55ae6a9312e374755f4684879f90fbffbb1ab78b9668c34fa073";
const EXPIRES=Date.parse("2026-09-02T02:15:07.927Z");
const CONFIRM="RESET_ALL_EARLY_ACCESS_DATA_PRESERVE_USERS_AND_CONFIG";
const ENTITIES=["CaseEvidence","CaseResolution","CaseAppeal","DisputeCaseNote","ContestRecordAnnotation","IntegrityAuditLog","FairPlayAnalysis","MatchDeclineLog","SettlementReconciliation","OperationsFinding","DailyOperationsBrief","CampaignDelivery","CampaignEmailLog","CampaignRun","EmailLog","LaunchNotification","SiteVisit","MfaSession","MfaCode","MfaAuditLog","PrivacyPolicyAcceptance","JurisdictionInterest","IntegrationReference","integration-reference","IntegrationEvent","LedgerEntry","LedgerOperation","WalletTransaction","Game","Match","ContestRecord","IntegrityFlag","DisputeCase","SeamlessOperation","SeamlessPaymentProfile","SeamlessBankAccount","SocureIdentityVerification","SocureBankVerification","PlaidBankAccount","seamless-merchant-balance-snapshot","seamless-pooled-funds-reconciliation","JurisdictionVerificationLog","Wallet","SystemLedgerAccount"];
const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
async function digest(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("")}
function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0}
async function count(entity:any){let total=0;for(let skip=0;;skip+=5000){const rows=await entity.list("created_date",5000,skip,["id"]);total+=rows.length;if(rows.length<5000)return total}}
async function remove(entity:any){let total=0;for(;;){const rows=await entity.list("created_date",500,0,["id"]);if(!rows.length)return total;for(const row of rows){await entity.delete(row.id);total++}}}
const page=`<!doctype html><meta charset="utf-8"><title>ChessBet launch reset</title>
<style>body{font:16px system-ui;max-width:800px;margin:48px auto;padding:0 20px}input,button{font:inherit;padding:10px;margin:6px 0}input{width:100%}pre{white-space:pre-wrap;background:#f4f4f4;padding:16px}</style>
<h1>ChessBet launch reset</h1><p>Sandbox-only, time-limited, one-time-token protected. Preserves User, PrivacyPolicyConfig and GameSettings.</p>
<input id="token" type="password" autocomplete="off" placeholder="One-time reset token">
<button id="dry">Dry run</button><button id="execute">Execute authorized reset</button><pre id="out">Ready.</pre>
<script>const out=document.getElementById("out");async function run(mode){out.textContent="Running "+mode+"…";const r=await fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+document.getElementById("token").value},body:JSON.stringify({mode,confirmation:"RESET_ALL_EARLY_ACCESS_DATA_PRESERVE_USERS_AND_CONFIG"})});out.textContent=JSON.stringify({status:r.status,body:await r.json()},null,2)}document.getElementById("dry").onclick=()=>run("dry_run");document.getElementById("execute").onclick=()=>run("execute");</script>`;
Deno.serve(async(req)=>{
 try{
  if(req.method==="GET")return new Response(page,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  if(Date.now()>EXPIRES)return json({error:"reset_window_expired"},410);
  if((Deno.env.get("SEAMLESS_ACH_ENV")||"").toLowerCase()!=="sandbox")return json({error:"sandbox_required"},409);
  const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(!equal(await digest(token),HASH))return json({error:"unauthorized"},401);
  const body=await req.json().catch(()=>({}));
  if(body.confirmation!==CONFIRM)return json({error:"confirmation_required"},400);
  if(body.mode!=="dry_run"&&body.mode!=="execute")return json({error:"invalid_mode"},400);
  const client=createClientFromRequest(req);const service=client.asServiceRole.entities as Record<string,any>;const results:Record<string,number>={};
  for(const name of ENTITIES){const entity=service[name];results[name]=!entity?0:body.mode==="dry_run"?await count(entity):await remove(entity)}
  const users=await service.User.list("created_date",5000,0,["id"]);let updated=0;
  if(body.mode==="execute"){const r=await service.User.updateMany({},{$set:{identity_verification_status:"not_started",last_geolocation_status:"not_checked",jurisdiction_status:"unknown",jurisdiction_vpn_detected:false,games_played:0,games_won:0,games_lost:0,win_percentage:0,withdrawal_hold:false,account_state:"provisional"},$unset:{identity_verified_at:"",identity_verification_provider:"",identity_provider_reference:"",verified_id_hash:"",last_geolocation_checked_at:"",current_jurisdiction_state:"",current_jurisdiction_country:"",jurisdiction_last_verified_at:"",jurisdiction_verification_provider:""}});updated=Number(r?.updated||0)}
  return json({success:true,mode:body.mode,users_preserved:users.length,users_updated:updated,record_counts:results,preserved_entities:["User","PrivacyPolicyConfig","GameSettings"],provider_calls:0,published:false});
 }catch(error){console.error("launch reset failed",error);return json({success:false,error:"launch_reset_failed",message:error instanceof Error?error.message:String(error)},500)}
});