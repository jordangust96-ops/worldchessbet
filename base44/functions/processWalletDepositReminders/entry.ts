import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { claimWebhookEvent, finishWebhookEvent } from '../../shared/seamlessAtomicStore.ts';
import { hasVerifiedIdentity } from '../../shared/identityEligibility.js';
import { walletOnboardingLocation } from '../../shared/walletOnboardingLocation.ts';
import { paidContestsEnabled, seamlessDepositsEnabled } from '../../shared/seamlessFundingConfig.ts';
import { REMINDER_CAMPAIGN, REMINDER_SUBJECT, reminderEligibility, buildWalletDepositReminder } from '../../shared/walletDepositReminder.js';

async function allRows(entity, query, fields) {
  const rows = [], seen = new Set();
  for (let skip = 0; ; skip += 500) {
    const page = await entity.filter(query, 'created_date', 500, skip, fields);
    for (const row of page) {
      if (!row.id || seen.has(row.id)) throw new Error('incomplete_recipient_scan');
      seen.add(row.id); rows.push(row);
    }
    if (page.length < 500) return rows;
  }
}
async function snapshot(base44, userId) {
  const svc=base44.asServiceRole.entities;
  const [user,banks,wallets,deposits,deliveries]=await Promise.all([
    svc.User.get(userId),
    allRows(svc.SeamlessBankAccount,{user_id:userId},['id','user_id','source_id','status','verified_at']),
    allRows(svc.Wallet,{user_id:userId},['id','user_id','balance','available_balance','held_balance','total_balance','total_deposited']),
    allRows(svc.WalletTransaction,{user_id:userId,type:'deposit',launch_epoch:2},['id','user_id','type','launch_epoch','source_event','status','integration_status','processed_at','created_date']),
    allRows(svc.CampaignDelivery,{user_id:userId,campaign_key:REMINDER_CAMPAIGN},['id','status']),
  ]);
  return {user,banks,wallets,deposits,deliveries};
}
async function ready(base44, data) {
  const decision=reminderEligibility(data);
  if (!decision.eligible) return decision;
  if (!await hasVerifiedIdentity(base44,data.user)) return {eligible:false,reason:'identity_not_ready'};
  if (!(await walletOnboardingLocation(base44,data.user.id)).allowed) return {eligible:false,reason:'location_not_ready'};
  return decision;
}

// Empty/manual requests are read-only. The scheduled workflow explicitly passes
// dryRun:false. No request parameters can supply recipients or change the copy.
Deno.serve(async req => {
  try {
    const base44=createClientFromRequest(req);
    const caller=await base44.auth.me().catch(()=>null);
    if (!caller) return Response.json({error:'Unauthorized'},{status:401});
    if (caller.role !== 'admin') return Response.json({error:'Forbidden'},{status:403});
    const body=await req.json().catch(()=>({}));
    const dryRun=body.dryRun !== false;
    const stats={ok:true,dry_run:dryRun,considered:0,due:0,sent:0,skipped:0,failed:0,reasons:{}};
    const skip=reason => {stats.skipped++;stats.reasons[reason]=(stats.reasons[reason]||0)+1;};
    if (!paidContestsEnabled() || !seamlessDepositsEnabled()) {
      return Response.json({...stats,paused_reason:'deposits_or_paid_play_disabled'});
    }
    const svc=base44.asServiceRole.entities;
    const banks=await allRows(svc.SeamlessBankAccount,{status:'verified'},['id','user_id']);
    const userIds=[...new Set(banks.map(bank=>bank.user_id).filter(Boolean))];
    const policies=await svc.PrivacyPolicyConfig.filter({policy_type:'privacy_policy',is_active:true},'-created_date',1);
    const supportEmail=policies[0]?.support_email || 'hello@worldchessbet.com';
    let attempts=0;
    for (const userId of userIds) {
      if (!dryRun && attempts>=50) break;
      stats.considered++;
      let data=await snapshot(base44,userId);
      const candidate=await ready(base44,data);
      if (!candidate.eligible) {skip(candidate.reason);continue;}
      stats.due++;
      if (dryRun) continue;
      const key=REMINDER_CAMPAIGN+':'+userId, owner=crypto.randomUUID();
      const claim=await claimWebhookEvent(key,key,owner);
      if (claim?.claim !== 'owned') {skip(claim?.claim === 'completed' ? 'already_attempted' : 'busy');continue;}
      let delivery=null, attempted=false;
      try {
        // Recheck under a per-recipient lease immediately before preparing mail.
        data=await snapshot(base44,userId);
        const fresh=await ready(base44,data);
        if (!fresh.eligible) {skip(fresh.reason);continue;}
        let token=data.user.marketing_unsubscribe_token;
        if (!token) {
          token=crypto.randomUUID();
          await svc.User.update(userId,{marketing_unsubscribe_token:token});
        }
        // Use the persisted token and latest opt-out, funds, and bank state.
        data=await snapshot(base44,userId);
        const finalCheck=await ready(base44,data);
        if (!finalCheck.eligible) {skip(finalCheck.reason);continue;}
        token=data.user.marketing_unsubscribe_token;
        if (typeof token !== 'string' || token.length<20) throw new Error('unsubscribe_token_unavailable');
        const unsubscribeUrl='https://worldchessbet.com/unsubscribe?userId='+encodeURIComponent(userId)+'&token='+encodeURIComponent(token);
        const html=buildWalletDepositReminder({
          firstName:String(data.user.full_name||'').trim().split(/\s+/)[0]||'there',unsubscribeUrl,supportEmail
        });
        // Durable reservation precedes sending. Any existing reservation,
        // including an ambiguous timeout, suppresses automatic resends forever.
        delivery=await svc.CampaignDelivery.create({
          campaign_key:REMINDER_CAMPAIGN,user_id:userId,recipient_email:data.user.email,
          subject:REMINDER_SUBJECT,status:'sending',
          description:'One-time five-day verified-bank reminder. Reserved before email submission; never automatically resend an uncertain delivery.'
        });
        attempts++;
        attempted=true;
        await base44.asServiceRole.integrations.Core.SendEmail({
          to:data.user.email,subject:REMINDER_SUBJECT,body:html,from_name:'ChessBet'
        });
        stats.sent++;
        await svc.CampaignDelivery.update(delivery.id,{status:'success',sent_at:new Date().toISOString(),error_message:''});
        await svc.CampaignEmailLog.create({
          campaign_key:REMINDER_CAMPAIGN,user_id:userId,recipient_email:data.user.email,
          subject:REMINDER_SUBJECT,status:'success',description:'Deposit reminder accepted by email service.'
        });
      } catch (error) {
        stats.failed++;
        // The durable row prevents a resend even if the provider accepted the
        // message but its response/a later audit write failed.
        if (delivery) {
          try {
            await svc.CampaignEmailLog.create({
              campaign_key:REMINDER_CAMPAIGN,user_id:userId,recipient_email:data.user.email,
              subject:REMINDER_SUBJECT,status:'failed',
              error_message:'Delivery or audit confirmation requires review; automatic resend suppressed.'
            });
          } catch { /* A reserved delivery remains visible for admin review. */ }
        }
        console.error(JSON.stringify({event:'wallet_deposit_reminder_failed',user_id:userId,attempted}));
      } finally {
        // A durable row is the permanent guard; Redis additionally prevents
        // concurrent workers and covers a create response lost in transit.
        await finishWebhookEvent(key,key,owner,delivery || attempted ? 'completed' : 'retryable');
      }
    }
    return Response.json(stats);
  } catch {
    return Response.json({error:'wallet_deposit_reminder_sweep_failed'},{status:500});
  }
});
