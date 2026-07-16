import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Single authoritative eligibility pipeline for contest participation.
// Both Host Match (createMatch) and Join Match (acceptMatch) — public and
// private alike — invoke this exact function before any financial commitment
// or Match state transition occurs. There is no separate/duplicated version
// of this validation logic anywhere else.
//
// Checks run in a fixed order:
//   1. Identity Verification (account_state === 'verified')
//   2. Geolocation Check (fresh, re-verified server-side every call)
//   3. Participation Restrictions (admin-applied withdrawal_hold)
//   4. Available Balance Check (>= entryAmount)
//
// Returns { eligible: boolean, reason?: string } and never mutates any
// financial or Match state itself — callers only proceed with their own
// hold/ledger/match-state logic once eligible === true.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { entryAmount } = await req.json();
    const amount = Number(entryAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: 'Invalid entry amount' }, { status: 400 });
    }

    // 1. Identity Verification
    if (user.account_state !== 'verified') {
      const reason =
        user.account_state === 'suspended'
          ? 'Your account is currently suspended and cannot enter paid contests.'
          : user.account_state === 'closed'
          ? 'This account is closed and cannot enter paid contests.'
          : 'You must complete identity verification before you can enter a paid contest.';
      return Response.json({ eligible: false, reason });
    }

    // 2. Jurisdiction Check — always re-verified server-side, never trusted
    // from a stale value. Only 'approved' jurisdictions may proceed.
    const jurisdictionRes = await base44.functions.invoke('getCurrentJurisdiction', { triggerEvent: 'contest_eligibility' });
    if (jurisdictionRes.data?.error || jurisdictionRes.data?.status !== 'approved') {
      return Response.json({
        eligible: false,
        reason: jurisdictionRes.data?.reason || 'You are not currently eligible to enter a contest from your location.',
      });
    }

    // 3. Participation Restrictions — admin-applied hold during an integrity review.
    if (user.withdrawal_hold) {
      return Response.json({
        eligible: false,
        reason: 'Your account is currently under review and cannot enter new contests at this time.',
      });
    }

    // 4. Available Balance Check
    const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    const wallet = wallets[0];
    if (!wallet || (wallet.available_balance || 0) < amount) {
      return Response.json({ eligible: false, reason: 'Insufficient balance for this entry amount.' });
    }

    return Response.json({ eligible: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});