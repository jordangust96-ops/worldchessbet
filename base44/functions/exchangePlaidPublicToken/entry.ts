import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import { plaid } from '../../shared/plaid.ts';

Deno.serve(async (req) => {
 try {
  if (EARLY_ACCESS_MODE) return Response.json({ enabled: false, reason: 'Bank linking is unavailable during Early Access.' });
  const base44=createClientFromRequest(req); const user=await base44.auth.me();
  if (!user || !isSocureIdentityVerified(user)) return Response.json({error:'Verified account required'},{status:403});
  const { public_token, account_id, account_name, account_mask }=await req.json();
  if (!public_token || !account_id) return Response.json({error:'Bank account selection is required'},{status:400});
  const exchanged=await plaid('/item/public_token/exchange',{public_token});
  const existing=(await base44.asServiceRole.entities.PlaidBankAccount.filter({user_id:user.id, account_id}))[0];
  const record={user_id:user.id, account_id, account_name:account_name||'Bank account', account_mask:account_mask||'', plaid_access_token:exchanged.access_token, plaid_item_id:exchanged.item_id, status:'linked', linked_at:new Date().toISOString()};
  if(existing) await base44.asServiceRole.entities.PlaidBankAccount.update(existing.id,record); else await base44.asServiceRole.entities.PlaidBankAccount.create(record);
  return Response.json({success:true});
 } catch(error){ return Response.json({error:error?.message||'Unable to link bank account'},{status:500});}
});