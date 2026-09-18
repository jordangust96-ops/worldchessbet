import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { sendWithdrawalRequestedEmail } from '../../shared/withdrawalRequestedEmail.ts';
import { settleQueuedWithdrawalFee } from '../../shared/queuedWithdrawalFee.ts';
import { refundWithdrawalFee } from '../../shared/seamlessLedgerTransitions.ts';
import { allLedgerRows } from '../../shared/ledgerPagination.ts';
import { inspectPayoutCapacityStore } from '../../shared/seamlessAtomicStore.ts';
import { buildVerifiedWithdrawalBody } from '../../shared/verifiedWithdrawalBody.ts';
import { legalNameFromUser } from '../../shared/legalName.ts';
import { seamlessRequest } from '../../shared/seamlessAch.ts';
Deno.serve(async req=>{
 try{
  const base44=createClientFromRequest(req),caller=await base44.auth.me().catch(()=>null);
  if(!caller)return Response.json({error:'Unauthorized'},{status:401});
  if(caller.role!=='admin')return Response.json({error:'Forbidden'},{status:403});
  const input=await req.json().catch(()=>({}));
  const rows=await allLedgerRows(base44.asServiceRole.entities.WalletTransaction,{launch_epoch:2,type:'withdrawal',withdrawal_requested_at:{$exists:true}},'created_date');
  const candidates=rows.filter(tx=>['preparing','queued'].includes(tx.withdrawal_request_status)&&['pending','processing'].includes(tx.status));
  if(input.inspectOnly===true && input.inspectPayments===true){
    const tx=rows.find(tx=>tx.id===input.transactionId);
    if(!tx)return Response.json({error:'not_found'},{status:404});
    const dateStart=new Date(Date.parse(tx.withdrawal_requested_at)-86400000).toISOString().slice(0,10);
    const dateEnd=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const label='chessbet-withdrawal-'+tx.id, matches=[];
    let checked=0, total=null, complete=false;
    for(let page=1;page<=20;page++){
      const result=await seamlessRequest('GET','/check?limit=100&page='+page+'&date_start='+dateStart+'&date_end='+dateEnd);
      const list=result?.list, payments=Array.isArray(list)?list:list?.data;
      if(result?.success!==true || !Array.isArray(payments))return Response.json({inspect_only:true,error:'unexpected_payment_list'},{status:502});
      total=Array.isArray(list)?null:Number(list.total);
      checked+=payments.length;
      for(const payment of payments)if(payment.label===label)matches.push({check_id:payment.check_id,status:payment.status,amount:payment.amount,direction:payment.direction});
      if(Array.isArray(list)?payments.length<100:page>=Number(list.last_page)||Number.isFinite(total)&&checked>=total){complete=true;break;}
    }
    return Response.json({inspect_only:true,provider_submission:false,transaction_id:tx.id,checked,total,complete,matches});
  }
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
  const summary={queued:candidates.length,checked:0,submitted:0,pending:0,errors:0,emails_sent:0,review_required:0};
  // An interrupted submission must never look like ordinary bank processing.
  // Only classify the state; keep funds reserved and never retry the payout.
  for(const tx of rows.filter(tx=>tx.integration_status==='submitting' &&
    tx.withdrawal_request_status==='processing' &&
    Number.isFinite(Date.parse(tx.withdrawal_provider_attempt_at)) &&
    Date.parse(tx.withdrawal_provider_attempt_at)<Date.now()-5*60*1000).slice(0,50)){
    try{
      await base44.asServiceRole.entities.WalletTransaction.update(tx.id,{
        status:'review_required',integration_status:'uncertain',withdrawal_request_status:'review_required',
        description:'Withdrawal submission requires reconciliation. Funds remain reserved until the payment outcome is confirmed.',
        source_event:'seamless_withdrawal_reconciliation_required'});
      const audits=await base44.asServiceRole.entities.SeamlessOperation.filter({wallet_transaction_id:tx.id},'-created_date',2);
      for(const audit of audits)await base44.asServiceRole.entities.SeamlessOperation.update(audit.id,{
        status:'uncertain',last_error_code:audit.last_error_code||'submission_interrupted',updated_at:new Date().toISOString()});
      summary.review_required++;
    }catch{summary.errors++;}
  }
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