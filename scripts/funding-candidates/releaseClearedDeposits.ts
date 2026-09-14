import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { buildCheckLookupPath, mapTransactionStatus, seamlessRequest, seamlessConfig } from '../../shared/seamlessAch.ts';
import { depositProviderReference } from '../../shared/depositReconciliation.ts';
import { allLedgerRows } from '../../shared/ledgerPagination.ts';
import { releaseDepositAvailability, releaseDepositWithdrawal, reverseSeamlessSettlement, recoverFeeDepositState, PROCESSED_PLAY_ENABLED } from '../../shared/seamlessLedgerTransitions.ts';
import { claimWebhookEvent, finishWebhookEvent } from '../../shared/seamlessAtomicStore.ts';
import { sendDepositAvailableEmail } from '../../shared/depositAvailableEmail.ts';

// Existing schedule: playable release on verified Processed, then a separate
// five-business-day withdrawal confirmation. Every page is read before mutation.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({error:'Unauthorized'},{status:401});
    if (caller.role !== 'admin') return Response.json({error:'Forbidden'},{status:403});
    seamlessConfig();
    const held = await allLedgerRows(base44.asServiceRole.entities.WalletTransaction,
      {type:'deposit', status:'completed', deposit_hold_status:'held'}, 'deposit_release_at');
    const restricted = await allLedgerRows(base44.asServiceRole.entities.WalletTransaction,
      {type:'deposit', status:'completed', deposit_withdrawal_status:'held'}, 'deposit_release_at');
    const now=Date.now();
    const due=[...new Map([...held,...restricted].map(tx=>[tx.id,tx])).values()]
      .filter(tx=>PROCESSED_PLAY_ENABLED && tx.deposit_hold_status==='held' || Date.parse(tx.deposit_release_at || '')<=now).slice(0,50);
    const summary={held:held.length,due:due.length,checked:0,released:0,withdrawal_released:0,returned:0,pending:0,errors:0,emails_sent:0,email_errors:0};
    for (let tx of due) {
      try {
        const checkId=await depositProviderReference(base44,tx);
        const data=await seamlessRequest('GET', buildCheckLookupPath(checkId));
        const check=data?.check || data?.data?.check;
        if(!check || data?.success===false || String(check.check_id || '')!==checkId ||
          Number(check.amount)!==Number(tx.deposit_bank_debit ?? tx.amount)) throw new Error('provider_reference_mismatch');
        const normalized=mapTransactionStatus(String(check.status || ''));
        summary.checked++;
        if(normalized==='completed'){
          if(tx.deposit_hold_status==='held' && await releaseDepositAvailability(base44,tx)){
            summary.released++;
            const email=await sendDepositAvailableEmail(base44,tx).catch(()=>({failed:true}));
            if(email.sent)summary.emails_sent++;
            if(email.failed)summary.email_errors++;
          }
          tx=await base44.asServiceRole.entities.WalletTransaction.get(tx.id);
          if(Date.parse(tx.deposit_release_at || '')<=Date.now() && await releaseDepositWithdrawal(base44,tx))summary.withdrawal_released++;
        } else if(normalized==='failed'||normalized==='reversed'){
          const key='deposit-clearing-return:'+tx.id,owner=crypto.randomUUID();
          const claim=await claimWebhookEvent(key,checkId,owner);
          if(claim?.claim==='owned'){
            try {
              tx=await recoverFeeDepositState(base44,await base44.asServiceRole.entities.WalletTransaction.get(tx.id));
              if(tx.status==='completed')await reverseSeamlessSettlement(base44,tx,Number(tx.amount),checkId,'deposit_clearance_check_returned');
              await finishWebhookEvent(key,checkId,owner,'completed');
              summary.returned++;
            }catch(error){
              await finishWebhookEvent(key,checkId,owner,'retryable','deposit_return_failed').catch(()=>{});
              throw error;
            }
          }
        } else summary.pending++;
      }catch(error){
        summary.errors++;
        console.error(JSON.stringify({event:'deposit_clearance_check_failed',wallet_transaction_id:tx.id,error:String(error?.message||'unknown').slice(0,128)}));
      }
    }
    return Response.json(summary);
  }catch(error){return Response.json({error:'deposit_clearance_sweep_failed'},{status:500});}
});
