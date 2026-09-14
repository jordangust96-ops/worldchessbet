import { readFundingState, readFundingSources } from './fundingProvenance.ts';
import { sourceState } from './fundingProvenancePure.js';
import { bankBusinessDaysAfter } from './depositTiming.js';
import { payoutCapacity, DAY_MS, MONTH_WINDOW_MS } from './withdrawalLimits.js';
import { allLedgerRows } from './ledgerPagination.ts';
import { releaseDepositWithdrawal } from './seamlessLedgerTransitions.ts';
import { depositProviderReference } from './depositReconciliation.ts';
import { seamlessRequest, buildCheckLookupPath } from './seamlessAch.ts';

export async function queuedWithdrawalSources(base44,tx) {
 const state=await readFundingState(base44,tx.user_id);
 const lots=state.held['tx:'+tx.id]||[];
 const remainingFee=tx.withdrawal_fee_state==='reserved'?Number(tx.withdrawal_request_fee||0):0;
 if(lots.reduce((n,l)=>n+l.cents,0)!==Math.round((Number(tx.amount)+remainingFee)*100))throw Error('withdrawal_reservation_incomplete');
 return {lots,sources:await readFundingSources(base44,{[tx.user_id]:{available:[],held:{request:lots}}})};
}
export async function estimateQueuedWithdrawal(base44,tx) {
 const {sources}=await queuedWithdrawalSources(base44,tx);
 let ready=Date.now()+15*60*1000;
 for(const source of Object.values(sources)){
  const at=Date.parse(source.deposit_release_at||'');
  if(!Number.isFinite(at))throw Error('withdrawal_date_unknown');
  ready=Math.max(ready,at+15*60*1000);
 }
 const rows=await allLedgerRows(base44.asServiceRole.entities.WalletTransaction,{type:'withdrawal',launch_epoch:2},'created_date');
 const reservations=[];
 for(const row of rows.filter(row=>row.id!==tx.id)){
  if(['submitted','settled','uncertain','submitting','reversed'].includes(row.integration_status)){
   const at=Date.parse(row.withdrawal_provider_attempt_at||row.created_date);
   if(Number.isFinite(at))reservations.push({at,cents:Math.round(Number(row.amount)*100)});
  } else if(row.withdrawal_requested_at&&['pending','processing'].includes(row.status)&&Date.parse(row.created_date)<=Date.parse(tx.created_date)){
   reservations.push({at:Math.max(Date.now(),Date.parse(row.withdrawal_process_after||row.created_date)),cents:Math.round(Number(row.amount)*100)});
  }
 }
 const amount=Math.round(Number(tx.amount)*100);
 // Find a conservative window after earlier accepted or queued requests.
 for(let i=0;i<=reservations.length*2+2;i++){
  const scheduled=reservations.filter(r=>r.at<=ready);
  if(payoutCapacity(scheduled,amount,ready).allowed)break;
  const next=scheduled.flatMap(r=>[r.at+DAY_MS,r.at+MONTH_WINDOW_MS]).filter(t=>t>ready).sort((a,b)=>a-b)[0];
  if(!next)throw Error('withdrawal_estimate_unavailable');
  ready=next+60000;
 }
 // Standard credits can take four banking days when bank-funded; add one
 // processing/cutoff day. This is an estimate, never a promised payout date.
 return {withdrawal_process_after:new Date(ready).toISOString(),withdrawal_estimated_arrival:bankBusinessDaysAfter(new Date(ready).toISOString(),5)};
}
export async function queuedWithdrawalReady(base44,tx) {
 if(Date.parse(tx.withdrawal_process_after||'')>Date.now())return false;
 const {sources}=await queuedWithdrawalSources(base44,tx);
 for(let source of Object.values(sources)){
  if(sourceState(source)==='blocked'||Date.parse(source.deposit_release_at||'')>Date.now())return false;
  const ref=await depositProviderReference(base44,source);
  const data=await seamlessRequest('GET',buildCheckLookupPath(ref));
  const check=data?.check||data?.data?.check;
  if(!check||data?.success===false||String(check.check_id)!==ref||String(check.status).toLowerCase()!=='processed'||Number(check.amount)!==Number(source.deposit_bank_debit??source.amount)||(check.currency&&check.currency!=='USD'))return false;
  if(source.deposit_withdrawal_status!=='released')await releaseDepositWithdrawal(base44,source);
  source=await base44.asServiceRole.entities.WalletTransaction.get(source.id);
  if(sourceState(source)!=='clear')return false;
 }
 return true;
}
