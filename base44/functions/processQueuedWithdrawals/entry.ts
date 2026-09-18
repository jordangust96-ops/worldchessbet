import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { sendWithdrawalRequestedEmail } from '../../shared/withdrawalRequestedEmail.ts';
import { settleQueuedWithdrawalFee } from '../../shared/queuedWithdrawalFee.ts';
import { refundWithdrawalFee } from '../../shared/seamlessLedgerTransitions.ts';
import { allLedgerRows } from '../../shared/ledgerPagination.ts';
import { inspectPayoutCapacityStore } from '../../shared/seamlessAtomicStore.ts';
import { buildVerifiedWithdrawalBody } from '../../shared/verifiedWithdrawalBody.ts';
import { legalNameFromUser } from '../../shared/legalName.ts';
Deno.serve(async req=>{
 try{
  const base44=createClientFromRequest(req),caller=await base44.auth.me().catch(()=>null);
  if(!caller)return Response.json({error:'Unauthorized'},{status:401});
  if(caller.role!=='admin')return Response.json({error:'Forbidden'},{status:403});
  const input=await req.json().catch(()=>({}));
  const rows=await allLedgerRows(base44.asServiceRole.entities.WalletTransaction,{launch_epoch:2,type:'withdrawal',withdrawal_requested_at:{$exists:true}},'created_date');
  const candidates=rows.filter(tx=>['preparing','queued'].includes(tx.withdrawal_request_status)&&['pending','processing'].includes(tx.status));
  if(input.inspectOnly===true && input.inspectFunding===true){
   const tx=rows.find(tx=>tx.id===input.transactionId);
   if(!tx)return Response.json({error:'not_found'},{status:404});
   const profile=(await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({user_id:tx.user_id}))[0];
   const user=await base44.asServiceRole.entities.User.get(tx.user_id);
   const body=await buildVerifiedWithdrawalBody({providerUserId:profile?.provider_user_id,
    name:legalNameFromUser(user)?.fullName,amount:tx.amount,sourceId:tx.funding_source_id,
    label:'chessbet-withdrawal-'+tx.id});
   return Response.json({inspect_only:true,routing_valid:true,amount:body.amount,
    sender_account:body.account,recipient:body.recipient,recipient_source:tx.funding_source_id,
    provider_submission:false});
  }
  if(input.inspectOnly===true)return Response.json({queued:candidates.length,inspect_only:true,diagnostic_version:3,capacity:await inspectPayoutCapacityStore()});
  const summary={queued:candidates.length,checked:0,submitted:0,pending:0,errors:0,emails_sent:0};
  // Oldest requests first. Each request uses the same user lock, operation
  // identity and provider capacity election as interactive submission.
  for(const tx of candidates.slice(0,50)){
   if(Date.parse(tx.withdrawal_process_after||'')>Date.now())continue;
   try{
    const result=await base44.functions.invoke('submitSeamlessWithdrawal',{queuedTransactionId:tx.id});
    summary.checked++;if(result.data?.provider_reference_id)summary.submitted++;else summary.pending++;
   }catch{summary.errors++;}
  }
  for(const tx of rows.filter(tx=>tx.withdrawal_fee_state==='reserved'&&['submitted','settled','failed','reversed'].includes(tx.integration_status)).slice(0,50)){
   try{if(['failed','reversed'].includes(tx.status))await refundWithdrawalFee(base44,tx,tx.id);else await settleQueuedWithdrawalFee(base44,tx);}catch{summary.errors++;}
  }
  for(const tx of rows.filter(tx=>['pending','failed','processing'].includes(tx.withdrawal_request_email_status)&&Number(tx.withdrawal_request_email_attempts||0)<8&&!(Date.parse(tx.withdrawal_request_email_next_attempt_at||'')>Date.now())).slice(0,50)){
   try{const result=await sendWithdrawalRequestedEmail(base44,tx);if(result.sent)summary.emails_sent++;}catch{summary.errors++;}
  }
  return Response.json(summary);
 }catch{return Response.json({error:'withdrawal_queue_check_failed'},{status:500});}
});