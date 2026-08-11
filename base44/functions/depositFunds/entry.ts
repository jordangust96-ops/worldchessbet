import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';

// Server-authoritative deposit handler. The client only ever sends the
// requested amount — the resulting balance is always computed here from the
// Internal Ledger, so a client can never dictate its own balance directly.
const MAX_DEPOSIT_AMOUNT = 10000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      amount,
      browserGeoPermission,
      browserLatitude,
      browserLongitude,
      browserAccuracyMeters,
      deviceFingerprintHash,
    } = await req.json();
    const requestedAmount = Number(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > MAX_DEPOSIT_AMOUNT) {
      return Response.json({ error: 'Invalid funding amount' }, { status: 400 });
    }

    // Only Verified accounts may deposit funds (Provisional/Suspended/Closed
    // cannot) — bypassed while EARLY_ACCESS_MODE is true (pre-launch testing
    // only; see base44/shared/earlyAccess.ts).
    if (!EARLY_ACCESS_MODE && user.account_state !== 'verified') {
      return Response.json({
        eligible: false,
        reason: user.account_state === 'suspended'
          ? 'Your account is currently suspended and cannot deposit funds.'
          : user.account_state === 'closed'
          ? 'This account is closed and cannot deposit funds.'
          : 'You must complete identity verification before you can deposit funds.',
      });
    }

    // Re-verify jurisdiction server-side rather than trusting a prior
    // client-side check — deposits are always gated on a fresh lookup.
    const jurisdictionRes = await base44.functions.invoke('getCurrentJurisdiction', {
      triggerEvent: 'deposit',
      relatedEntityType: 'deposit',
      contextAmount: requestedAmount,
      browserGeoPermission,
      browserLatitude,
      browserLongitude,
      browserAccuracyMeters,
      deviceFingerprintHash,
    });
    if (jurisdictionRes.data?.error || jurisdictionRes.data?.status !== 'approved') {
      return Response.json({
        eligible: false,
        reason: jurisdictionRes.data?.reason || 'You are not currently eligible to fund your account.',
      });
    }

    const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'deposit',
      amount: requestedAmount,
      description: 'Account funded',
    });

    // Double-entry: Debit Settlement Account, Credit User Available Balance.
    await postLedgerLegs(base44, {
      groupId: crypto.randomUUID(),
      walletTransactionId: walletTransaction.id,
      actor: 'user',
      actorId: user.id,
      triggerEvent: 'deposit',
      legs: [
        { ledgerAccount: 'settlement', debit: requestedAmount, credit: 0, transactionType: 'deposit' },
        { ledgerAccount: 'user_account', userId: user.id, debit: 0, credit: requestedAmount, transactionType: 'deposit', totalDepositedDelta: requestedAmount },
      ],
    });

    const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    return Response.json({ eligible: true, wallet: wallets[0] });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});