import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { EARLY_ACCESS_MODE } from '../../shared/earlyAccess.ts';

// Reserves a player's Entry Amount into escrow during the shared Preparing
// Match phase. Requires that player to have already certified Fair Play.
// Runs server-side with the service role so the wallet balance deduction is
// always computed from the Internal Ledger — a client can never set its own
// balance. Once both players have certified AND reserved funds, this
// function is also the trigger that creates/loads the Game and takes the
// match live.
//
// Financial model: the Contest Entry Amount and the Platform Service Fee
// (a published fixed-dollar amount) are two independent, separately-disclosed
// charges. The Entry Amount moves into the Contest Reserve
// ('contest_clearing') where it stays untouched until settlement. The
// Service Fee moves into 'suspense' — pending, not yet recognized revenue —
// and is only ever promoted to 'platform_revenue' once the match settles
// with a decisive result. Each charge gets its own WalletTransaction and its
// own balanced ledger group so the two remain independently auditable.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Only Verified accounts may enter paid contests (Provisional/Suspended/
    // Closed cannot) — bypassed while EARLY_ACCESS_MODE is true (pre-launch
    // testing only; see base44/shared/earlyAccess.ts).
    if (!EARLY_ACCESS_MODE && user.account_state !== 'verified') {
      return Response.json({ error: 'Your account must be verified before you can enter a paid contest' }, { status: 403 });
    }

    const {
      matchId,
      browserGeoPermission,
      browserLatitude,
      browserLongitude,
      browserAccuracyMeters,
      deviceFingerprintHash,
    } = await req.json();

    // Re-verify jurisdiction immediately before payment authorization — never
    // rely on a stale client-side or earlier-in-flow check.
    const jurisdictionRes = await base44.functions.invoke('getCurrentJurisdiction', {
      triggerEvent: 'lock_wager',
      relatedEntityType: 'match',
      relatedEntityId: matchId || '',
      browserGeoPermission,
      browserLatitude,
      browserLongitude,
      browserAccuracyMeters,
      deviceFingerprintHash,
    });
    if (jurisdictionRes.data?.error || jurisdictionRes.data?.status !== 'approved') {
      return Response.json({ error: jurisdictionRes.data?.reason || 'You are not currently eligible to fund a contest entry from your location.' }, { status: 403 });
    }

    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });

    let match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    if (match.status !== 'preparing' && match.status !== 'both_ready') {
      return Response.json({ error: 'This match is not currently accepting entry reservations' }, { status: 400 });
    }

    const alreadyDeposited = isP1 ? match.player1_deposited : match.player2_deposited;
    if (alreadyDeposited) {
      return Response.json({ error: 'You have already reserved your entry amount' }, { status: 400 });
    }

    const certified = isP1 ? match.player1_certified : match.player2_certified;
    if (!certified) {
      return Response.json({ error: 'Certify Fair Play before reserving your entry amount' }, { status: 400 });
    }

    const fundingOperationField = isP1 ? 'player1_funding_operation_id' : 'player2_funding_operation_id';
    if (match[fundingOperationField]) {
      return Response.json({ error: 'funding_in_progress' }, { status: 409 });
    }
    const fundingOperationId = crypto.randomUUID();
    await base44.asServiceRole.entities.Match.update(match.id, {
      [fundingOperationField]: fundingOperationId,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    match = await base44.asServiceRole.entities.Match.get(match.id);
    if (match[fundingOperationField] !== fundingOperationId) {
      return Response.json({ error: 'funding_claim_lost' }, { status: 409 });
    }
    if (isP1 ? match.player1_deposited : match.player2_deposited) {
      return Response.json({ error: 'already_funded' }, { status: 409 });
    }

    const serviceFee = Number(match.platform_service_fee);
    if (!Number.isFinite(serviceFee) || serviceFee < 0) {
      return Response.json({ error: 'This contest is missing its disclosed Platform Service Fee.' }, { status: 409 });
    }
    const totalCharge = match.wager_amount + serviceFee;

    const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
    const wallet = wallets[0];
    if (!wallet || wallet.available_balance < totalCharge) {
      return Response.json({ error: 'Insufficient balance for this entry amount and platform service fee' }, { status: 400 });
    }

    const entryTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'wager_lock',
      amount: match.wager_amount,
      match_id: match.id,
      description: 'Contest entry amount reserved for match',
    });

    // Double-entry: Debit User Available Balance, Credit Contest Reserve.
    // The debited amount is simultaneously moved into the user's held balance.
    await postLedgerLegs(base44, {
      groupId: crypto.randomUUID(),
      matchId: match.id,
      walletTransactionId: entryTransaction.id,
      actor: 'user',
      actorId: user.id,
      triggerEvent: 'match_entry',
      externalRefType: 'match',
      externalRefId: match.id,
      legs: [
        { ledgerAccount: 'user_account', userId: user.id, debit: match.wager_amount, credit: 0, heldDelta: match.wager_amount, transactionType: 'match_entry', totalWageredDelta: match.wager_amount },
        { ledgerAccount: 'contest_clearing', debit: 0, credit: match.wager_amount, transactionType: 'match_entry' },
      ],
    });

    const feeTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: user.id,
      type: 'service_fee_charge',
      amount: serviceFee,
      match_id: match.id,
      description: 'Platform service fee charged for match',
    });

    // Separate double-entry, in its own balanced group: Debit User Available
    // Balance, Credit Suspense (pending — not yet recognized as revenue until
    // the match settles with a decisive result).
    await postLedgerLegs(base44, {
      groupId: crypto.randomUUID(),
      matchId: match.id,
      walletTransactionId: feeTransaction.id,
      actor: 'user',
      actorId: user.id,
      triggerEvent: 'service_fee_charge',
      externalRefType: 'match',
      externalRefId: match.id,
      legs: [
        { ledgerAccount: 'user_account', userId: user.id, debit: serviceFee, credit: 0, heldDelta: serviceFee, transactionType: 'platform_fee' },
        { ledgerAccount: 'suspense', debit: 0, credit: serviceFee, transactionType: 'platform_fee' },
      ],
    });

    const depositUpdates = isP1
      ? { player1_deposited: true, player1_funding_operation_id: fundingOperationId }
      : { player2_deposited: true, player2_funding_operation_id: fundingOperationId };
    let updatedMatch = await base44.asServiceRole.entities.Match.update(match.id, depositUpdates);

    await recordIntegrationEvent(base44, {
      eventType: 'contest.participant_funded',
      aggregateType: 'match',
      aggregateId: match.id,
      correlationId: match.id,
      idempotencyKey: `contest.participant_funded:${match.id}:${user.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      counterpartyUserId: isP1 ? match.player2_id : match.player1_id,
      matchId: match.id,
      status: updatedMatch.status,
      amount: totalCharge,
      result: 'entry_and_fee_reserved',
      eventData: {
        player_role: isP1 ? 'player1' : 'player2',
        entry_amount: match.wager_amount,
        platform_service_fee: serviceFee,
        total_reserved: totalCharge,
        wallet_transaction_ids: [entryTransaction.id, feeTransaction.id],
      },
    });

    // Only when BOTH players have certified Fair Play AND successfully
    // reserved funds does the match go live — never earlier. finalizeMatchStart
    // is idempotent, so even if certifyFairPlay's own readiness check fires
    // this same transition concurrently, only one Game is ever created — and
    // it's also the same repair path the client can re-invoke if this ever
    // fails partway, leaving the match stuck at "both_ready".
    const bothCertified = updatedMatch.player1_certified && updatedMatch.player2_certified;
    const bothDeposited = updatedMatch.player1_deposited && updatedMatch.player2_deposited;
    if (bothCertified && bothDeposited) {
      const finalizeRes = await base44.functions.invoke('finalizeMatchStart', { matchId: match.id });
      if (finalizeRes.data?.match) updatedMatch = finalizeRes.data.match;
    }

    return Response.json({ match: updatedMatch });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});