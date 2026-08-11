import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';

// Single authoritative eligibility pipeline for contest participation.
// Both Host Match (createMatch) and Join Match (acceptMatch) — public and
// private alike — invoke this exact function before any financial commitment
// or Match state transition occurs. There is no separate/duplicated version
// of this validation logic anywhere else.
//
// Checks run in a fixed, cost-aware order:
//   1. Identity Verification (account_state === 'verified')
//   2. Participation Restrictions (admin-applied withdrawal_hold)
//   3. Available Balance Check (>= entryAmount)
//   4. Jurisdiction Check (fresh or same-IP short-cache, server-side)
//
// Cheap local checks run first so an account that cannot participate never
// causes a paid location lookup.
//
// Returns { eligible: boolean, reason?: string } and never mutates any
// financial or Match state itself — callers only proceed with their own
// hold/ledger/match-state logic once eligible === true.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { entryAmount, triggerEvent, relatedEntityType, relatedEntityId } = await req.json();
    const amount = Number(entryAmount);
    const jurisdictionTrigger = ['create_match', 'accept_match'].includes(triggerEvent)
      ? triggerEvent
      : 'contest_eligibility';
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: 'Invalid entry amount' }, { status: 400 });
    }

    // 1. Identity Verification — bypassed while EARLY_ACCESS_MODE is true
    // (pre-launch testing only; see base44/shared/earlyAccess.ts).
    if (!EARLY_ACCESS_MODE && user.account_state !== 'verified') {
      const reason =
        user.account_state === 'suspended'
          ? 'Your account is currently suspended and cannot enter paid contests.'
          : user.account_state === 'closed'
          ? 'This account is closed and cannot enter paid contests.'
          : 'You must complete identity verification before you can enter a paid contest.';
      return Response.json({ eligible: false, reason });
    }

    // 2. Participation Restrictions — admin-applied hold during an integrity review.
    if (user.withdrawal_hold) {
      return Response.json({
        eligible: false,
        reason: 'Your account is currently under review and cannot enter new contests at this time.',
      });
    }

    // 3. Available Balance Check
    const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    const wallet = wallets[0];
    if (!wallet || (wallet.available_balance || 0) < amount) {
      return Response.json({ eligible: false, reason: 'Insufficient balance for this entry amount.' });
    }

    // 4. Jurisdiction Check — performed only after all free local checks pass.
    // getCurrentJurisdiction may reuse a recent result only for the exact same
    // trusted edge IP; otherwise it performs a fresh provider lookup.
    const jurisdictionRes = await base44.functions.invoke('getCurrentJurisdiction', {
      triggerEvent: jurisdictionTrigger,
      relatedEntityType: relatedEntityType || 'match',
      relatedEntityId: relatedEntityId || '',
      contextAmount: amount,
    });
    if (jurisdictionRes.data?.error || jurisdictionRes.data?.status !== 'approved') {
      return Response.json({
        eligible: false,
        reason: jurisdictionRes.data?.reason || 'You are not currently eligible to enter a contest from your location.',
      });
    }

    return Response.json({ eligible: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});