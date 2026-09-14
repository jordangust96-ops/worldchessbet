import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { requireAdminMfa } from '../../shared/mfa.ts';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { seamlessRequest, buildCheckLookupPath } from '../../shared/seamlessAch.ts';
import { claimWebhookEvent, finishWebhookEvent } from '../../shared/seamlessAtomicStore.ts';
const TX='6aa1e4c979d0708fbf195281', USER='6a4ed72636c51cb3280d2bc7', REF='d8fabdf2-c67e-4dd5-89b0-901e7a52f1e3';
const GROUP='legacy-deposit-fee-adjustment:'+TX;
Deno.serve(async req=>{
 const base44=createClientFromRequest(req); let owner='';
 try {
  const admin=await base44.auth.me().catch(()=>null), body=await req.json();
  const denied=await requireAdminMfa(base44,admin,body.sessionToken,req.headers.get('user-agent')||'');
  if(denied)return denied;
  if(admin.id!==USER) return Response.json({error:'forbidden'},{status:403});
  const checkData=await seamlessRequest('GET',buildCheckLookupPath(REF));
  const check=checkData?.check||checkData?.data?.check;
  if(!check||checkData.success===false||check.check_id!==REF||Number(check.amount)!==10||String(check.status).toLowerCase()!=='processed'||(check.currency&&check.currency!=='USD')||(check.label&&check.label!=='chessbet-deposit-'+TX))throw Error('provider_verification_failed');
  const tx=await base44.asServiceRole.entities.WalletTransaction.get(TX);
  if(tx.user_id!==USER||tx.type!=='deposit'||Number(tx.amount)!==10||tx.status!=='completed'||tx.deposit_hold_status!=='released'||tx.deposit_pricing_version)throw Error('legacy_deposit_changed');
  const summary={original_bank_debit:10,processor_fee:0.65,cushion:0.10,adjustment:0.75,resulting_deposit_value:9.25,processor_accounting:'Reserved in processor_fee_clearing pending exact settlement allocation; dashboard fee $0.65, merchant balance $9.45 observed Sep 14. Original deposit and withdrawal hold preserved.'};
  if(body.commit!==true)return Response.json({dryRun:true,...summary});
  owner=crypto.randomUUID();
  const claim=await claimWebhookEvent(GROUP,REF,owner);
  if(claim?.claim!=='owned'&&claim?.claim!=='completed')throw Error('deposit_update_busy');
  if(claim.claim==='completed')return Response.json({deduplicated:true,...summary});
  let adjustments=await base44.asServiceRole.entities.WalletTransaction.filter({idempotency_key:GROUP},'-created_date',2);
  if(adjustments.length>1)throw Error('duplicate_adjustment');
  let adjustment=adjustments[0]||await base44.asServiceRole.entities.WalletTransaction.create({user_id:USER,type:'admin_reversal',amount:0.75,status:'pending',direction:'debit',currency:'USD',launch_epoch:2,idempotency_key:GROUP,source_event:'legacy_deposit_fee_adjustment',description:'Deposit fee adjustment: $0.65 Seamless fee + $0.10 ChessBet cushion on original $10 deposit. Net deposit $9.25. Authorized by account owner.',initiating_actor:'administrator',initiating_actor_id:USER});
  await postLedgerLegs(base44,{groupId:GROUP,walletTransactionId:adjustment.id,actor:'administrator',actorId:USER,triggerEvent:'legacy_deposit_fee_adjustment',externalRefType:'provider_payment',externalRefId:REF,updateTransactions:false,
   beforePost:async()=>{
    const current=await base44.asServiceRole.entities.WalletTransaction.get(TX);
    if(current.status!=='completed'||current.deposit_hold_status!=='released')throw Error('deposit_changed');
    const batches=await base44.asServiceRole.entities.LedgerJournalBatch.filter({ledger_group_id:GROUP},'-created_at',2);
    if(!batches.length){const wallets=await base44.asServiceRole.entities.Wallet.filter({user_id:USER});if(wallets.length!==1||Number(wallets[0].available_balance)!==10||Number(wallets[0].held_balance)!==0)throw Error('wallet_changed');}
    return true;
   },
   legs:[{ledgerAccount:'user_account',userId:USER,debit:0.75,credit:0,transactionType:'admin_adjustment'},{ledgerAccount:'processor_fee_clearing',debit:0,credit:0.65,transactionType:'admin_adjustment'},{ledgerAccount:'deposit_fee_revenue',debit:0,credit:0.10,transactionType:'admin_adjustment'}]});
  await base44.asServiceRole.entities.WalletTransaction.update(adjustment.id,{status:'completed',direction:'debit',integration_status:'internal_complete',ledger_group_id:GROUP,processed_at:adjustment.processed_at||new Date().toISOString()});
  await finishWebhookEvent(GROUP,REF,owner,'completed');owner='';
  return Response.json({completed:true,...summary});
 }catch(error){if(owner)await finishWebhookEvent(GROUP,REF,owner,'retryable','legacy_adjustment_failed').catch(()=>{});return Response.json({error:String(error?.message||'adjustment_failed')},{status:409});}
});
