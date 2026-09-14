import { postLedgerLegs } from './ledger.ts';
// The fee is reserved with the request, charged only after provider acceptance,
// and returned on rejection. One immutable decision prevents a charge/release race.
export async function settleQueuedWithdrawalFee(base44, tx, failed = false) {
 const fee=Number(tx.withdrawal_request_fee||0); if(!tx.withdrawal_requested_at||!fee)return null;
 const feeTx=await base44.asServiceRole.entities.WalletTransaction.get(tx.withdrawal_fee_transaction_id);
 if(!feeTx||feeTx.user_id!==tx.user_id||Number(feeTx.amount)!==fee)throw Error('withdrawal_fee_record_missing');
 const groupId='seamless:withdrawal:queued-fee:'+tx.id;
 const batches=await base44.asServiceRole.entities.LedgerJournalBatch.filter({ledger_group_id:groupId},'-created_at',2);
 if(batches.length>1)throw Error('duplicate_fee_decision');
 const fresh=await base44.asServiceRole.entities.WalletTransaction.get(tx.id);
 let release=failed||['failed','reversed'].includes(fresh.status);
 if(batches[0])release=batches[0].trigger_event==='queued_withdrawal_fee_release';
 else if(!release&&!['submitted','settled'].includes(fresh.integration_status))return null;
 const triggerEvent=release?'queued_withdrawal_fee_release':'queued_withdrawal_fee_charge';
 await postLedgerLegs(base44,{groupId,walletTransactionId:feeTx.id,updateTransactions:false,actor:'system',triggerEvent,externalRefType:'withdrawal',externalRefId:tx.id,
 beforePost:async()=>{
  const existing=await base44.asServiceRole.entities.LedgerJournalBatch.filter({ledger_group_id:groupId},'-created_at',1);
  if(existing[0]&&existing[0].trigger_event!==triggerEvent)throw Error('fee_decision_retry');
  if(!existing[0]&&!release){const current=await base44.asServiceRole.entities.WalletTransaction.get(tx.id);if(['failed','reversed'].includes(current.status))throw Error('fee_decision_retry');}
  return true;
 },
 legs:release?[
 {ledgerAccount:'withdrawal_reserve',debit:fee,credit:0,transactionType:'reversal'},
 {ledgerAccount:'user_account',userId:tx.user_id,walletTransactionId:tx.id,debit:0,credit:fee,heldDelta:-fee,transactionType:'reversal'}
 ]:[
 {ledgerAccount:'withdrawal_reserve',debit:fee,credit:0,transactionType:'withdrawal_fee'},
 {ledgerAccount:'platform_revenue',debit:0,credit:fee,transactionType:'withdrawal_fee'},
 {ledgerAccount:'user_account',userId:tx.user_id,walletTransactionId:tx.id,debit:0,credit:0,heldDelta:-fee,transactionType:'withdrawal_fee'}
 ]});
 await base44.asServiceRole.entities.WalletTransaction.update(feeTx.id,{status:release?'failed':'completed',integration_status:'internal_complete',direction:'debit',ledger_group_id:groupId,description:release?'Withdrawal fee not charged.':'Withdrawal fee: $'+fee.toFixed(2)+'.',processed_at:feeTx.processed_at||new Date().toISOString()});
 await base44.asServiceRole.entities.WalletTransaction.update(tx.id,{withdrawal_fee_state:release?'released':'charged'});
 return {charged:!release};
}
