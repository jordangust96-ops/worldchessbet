import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const VALID_STATUSES = ['open', 'under_review', 'awaiting_information'];
const VALID_ACTIONS = [
  'add_note',
  'escalate',
  'request_information',
  'change_status',
  'assign_to_me',
  'flag_fair_play_review',
  'flag_aml_review',
  'flag_manual_settlement_review',
  'place_pre_settlement_hold',
  'place_post_settlement_hold',
  'place_account_hold',
  'release_hold',
  'refer_case',
  'resolve_case',
];
const VALID_RESOLUTION_TYPES = [
  'no_violation',
  'contest_reversed',
  'contest_voided',
  'account_suspended',
  'account_closed',
  'funds_forfeited',
  'referred',
];
const fmtCase = (n) => `CB-${String(n).padStart(6, '0')}`;

// Moves funds between a user's Available and Held balances for an
// administrative investigation hold (or its release/consumption). Unlike
// contest settlement, this never moves value to another ledger account —
// the total stays with the user, only its availability changes — so the
// ledger entry is self-balancing (debit_amount === credit_amount), always
// immutable, and additive (a release/consumption never edits the original
// hold entry — it always creates a new one).
async function applyBalanceHold(base44, { userId, amount, direction, matchId, admin, triggerEvent }) {
  if (amount <= 0) return null;
  const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: userId });
  const wallet = wallets[0];
  if (!wallet) throw new Error('Wallet not found for this user');

  const delta = direction === 'hold' ? amount : -amount;
  const newAvailable = (wallet.available_balance || 0) - delta;
  const newHeld = (wallet.held_balance || 0) + delta;
  if (newAvailable < -0.01) throw new Error('Insufficient available balance to place this hold');

  const newTotal = newAvailable + newHeld;
  await base44.asServiceRole.entities.Wallet.update(wallet.id, {
    available_balance: newAvailable,
    held_balance: newHeld,
    total_balance: newTotal,
    balance: newAvailable,
  });

  return base44.asServiceRole.entities.LedgerEntry.create({
    user_id: userId,
    match_id: matchId || '',
    ledger_account: 'user_account',
    transaction_type: direction === 'hold' ? 'investigation_hold' : 'investigation_hold_release',
    debit_amount: amount,
    credit_amount: amount,
    resulting_available_balance: newAvailable,
    resulting_held_balance: newHeld,
    resulting_total_balance: newTotal,
    initiating_actor: 'administrator',
    initiating_actor_id: admin.id,
    trigger_event: triggerEvent,
    external_reference_type: matchId ? 'match' : 'none',
    external_reference_id: matchId || '',
    ledger_group_id: crypto.randomUUID(),
  });
}

// Debits/credits a user's balance for a contest reversal/void. Debits are
// taken from Held Balance when `fromHeld` is true (the funds are already
// isolated there by an active post-settlement hold on this same case),
// otherwise from Available Balance, capped at what is actually available so
// no balance ever goes negative. All legs across a call must balance
// (sum debit === sum credit); every leg posts its own immutable LedgerEntry.
async function postRemedyLegs(base44, { matchId, admin, triggerEvent, legs }) {
  const totalDebit = legs.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = legs.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    throw new Error(`Unbalanced remedy legs: debit=${totalDebit} credit=${totalCredit}`);
  }
  const groupId = crypto.randomUUID();
  const entries = [];
  for (const leg of legs) {
    if (leg.ledgerAccount === 'user_account') {
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: leg.userId });
      const wallet = wallets[0];
      if (!wallet) throw new Error('Wallet not found for user ' + leg.userId);

      let debit = leg.debit || 0;
      let availableDelta = -debit + (leg.credit || 0);
      let heldDelta = leg.heldDelta || 0;
      if (leg.fromHeld && debit > 0) {
        debit = Math.min(debit, wallet.held_balance || 0);
        availableDelta = leg.credit || 0;
        heldDelta = (leg.heldDelta || 0) - debit;
      } else if (debit > 0) {
        debit = Math.min(debit, wallet.available_balance || 0);
        availableDelta = -debit + (leg.credit || 0);
      }

      const newAvailable = (wallet.available_balance || 0) + availableDelta;
      const newHeld = (wallet.held_balance || 0) + heldDelta;
      const newTotal = newAvailable + newHeld;
      await base44.asServiceRole.entities.Wallet.update(wallet.id, {
        available_balance: newAvailable,
        held_balance: newHeld,
        total_balance: newTotal,
        balance: newAvailable,
      });
      entries.push(
        await base44.asServiceRole.entities.LedgerEntry.create({
          user_id: leg.userId,
          match_id: matchId || '',
          ledger_account: 'user_account',
          transaction_type: leg.transactionType,
          debit_amount: debit,
          credit_amount: leg.credit || 0,
          resulting_available_balance: newAvailable,
          resulting_held_balance: newHeld,
          resulting_total_balance: newTotal,
          initiating_actor: 'administrator',
          initiating_actor_id: admin.id,
          trigger_event: triggerEvent,
          external_reference_type: 'match',
          external_reference_id: matchId || '',
          ledger_group_id: groupId,
        })
      );
    } else {
      const accounts = await base44.asServiceRole.entities.SystemLedgerAccount.filter({ account_name: leg.ledgerAccount });
      let acct = accounts[0];
      if (!acct) acct = await base44.asServiceRole.entities.SystemLedgerAccount.create({ account_name: leg.ledgerAccount, balance: 0 });
      const newBalance = (acct.balance || 0) - (leg.debit || 0) + (leg.credit || 0);
      await base44.asServiceRole.entities.SystemLedgerAccount.update(acct.id, { balance: newBalance });
      entries.push(
        await base44.asServiceRole.entities.LedgerEntry.create({
          match_id: matchId || '',
          ledger_account: leg.ledgerAccount,
          transaction_type: leg.transactionType,
          debit_amount: leg.debit || 0,
          credit_amount: leg.credit || 0,
          resulting_total_balance: newBalance,
          initiating_actor: 'administrator',
          initiating_actor_id: admin.id,
          trigger_event: triggerEvent,
          external_reference_type: 'match',
          external_reference_id: matchId || '',
          ledger_group_id: groupId,
        })
      );
    }
  }
  return entries;
}

async function updatePlayerStatsDelta(base44, playerId, outcomeDelta) {
  if (!playerId) return;
  const player = await base44.asServiceRole.entities.User.get(playerId);
  const gamesPlayed = Math.max(0, (player.games_played || 0) - 1);
  const gamesWon = Math.max(0, (player.games_won || 0) - (outcomeDelta === 'win' ? 1 : 0));
  const gamesLost = Math.max(0, (player.games_lost || 0) - (outcomeDelta === 'loss' ? 1 : 0));
  const winPercentage = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;
  await base44.asServiceRole.entities.User.update(playerId, {
    games_played: gamesPlayed,
    games_won: gamesWon,
    games_lost: gamesLost,
    win_percentage: winPercentage,
  });
}

async function findContestRecord(base44, matchId) {
  if (!matchId) return null;
  const records = await base44.asServiceRole.entities.ContestRecord.filter({ match_id: matchId });
  return records[0] || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { caseId, action, payload = {} } = await req.json();
    if (!caseId) return Response.json({ error: 'caseId is required' }, { status: 400 });
    if (!VALID_ACTIONS.includes(action)) return Response.json({ error: 'Invalid action' }, { status: 400 });

    const disputeCase = await base44.asServiceRole.entities.DisputeCase.get(caseId);
    if (!disputeCase) return Response.json({ error: 'Case not found' }, { status: 404 });
    if (action !== 'add_note' && (disputeCase.status === 'resolved' || disputeCase.status === 'closed')) {
      return Response.json({ error: 'This case is already resolved/closed' }, { status: 400 });
    }

    const caseUpdates = {};
    let actionType = 'note_added';
    let noteContent = payload.content || payload.notes || '';
    let visibleToUser = false;
    let previousStatus = '';
    let newStatus = '';

    switch (action) {
      case 'add_note':
        actionType = 'note_added';
        if (!noteContent.trim()) return Response.json({ error: 'content is required' }, { status: 400 });
        visibleToUser = !!payload.visible_to_user;
        break;

      case 'escalate':
        actionType = 'escalated';
        caseUpdates.escalated = true;
        caseUpdates.priority = 'high';
        noteContent = noteContent || 'Case escalated for priority review.';
        break;

      case 'request_information':
        actionType = 'info_requested';
        previousStatus = disputeCase.status;
        newStatus = 'awaiting_information';
        caseUpdates.status = 'awaiting_information';
        noteContent = noteContent || 'Additional information requested from the reporting user.';
        visibleToUser = true;
        break;

      case 'flag_fair_play_review':
        actionType = 'flagged_fair_play';
        caseUpdates.fair_play_review_flag = true;
        noteContent = noteContent || 'Flagged for fair play / anti-cheat review.';
        break;

      case 'flag_aml_review':
        actionType = 'flagged_aml';
        caseUpdates.aml_review_flag = true;
        noteContent = noteContent || 'Flagged for AML/compliance review.';
        break;

      case 'flag_manual_settlement_review':
        actionType = 'flagged_manual_settlement';
        caseUpdates.manual_settlement_review_flag = true;
        noteContent = noteContent || 'Flagged for manual settlement review.';
        break;

      case 'change_status':
        // Investigation-phase transitions only — reaching resolved/closed
        // always requires resolve_case, which records a formal CaseResolution.
        if (!VALID_STATUSES.includes(payload.status)) {
          return Response.json({ error: 'Invalid status — use resolve_case to conclude a case' }, { status: 400 });
        }
        actionType = 'status_changed';
        previousStatus = disputeCase.status;
        newStatus = payload.status;
        caseUpdates.status = payload.status;
        noteContent = noteContent || `Status changed to ${payload.status}.`;
        visibleToUser = true;
        break;

      case 'assign_to_me':
        actionType = 'assigned';
        caseUpdates.assigned_admin_id = admin.id;
        noteContent = noteContent || `Assigned to ${admin.full_name || admin.email}.`;
        break;

      // --- Financial Hold Actions — administrator-only; never triggered by users ---
      case 'place_pre_settlement_hold': {
        if (!disputeCase.match_id) return Response.json({ error: 'This case has no linked match' }, { status: 400 });
        const match = await base44.asServiceRole.entities.Match.get(disputeCase.match_id);
        if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
        if (match.status === 'completed') {
          return Response.json({ error: 'This contest has already settled — use a post-settlement hold instead' }, { status: 400 });
        }
        await base44.asServiceRole.entities.Match.update(match.id, { settlement_hold: true });
        actionType = 'hold_placed';
        caseUpdates.hold_status = 'pre_settlement_hold';
        caseUpdates.hold_placed_at = new Date().toISOString();
        noteContent = noteContent || 'Pre-settlement hold placed — payout paused pending investigation. Funds remain in the Contest Clearing Account.';
        break;
      }
      case 'place_post_settlement_hold': {
        if (!disputeCase.match_id) return Response.json({ error: 'This case has no linked match' }, { status: 400 });
        const match = await base44.asServiceRole.entities.Match.get(disputeCase.match_id);
        if (!match || match.status !== 'completed') {
          return Response.json({ error: 'This contest has not settled yet — use a pre-settlement hold instead' }, { status: 400 });
        }
        const targetUserId = payload.userId || disputeCase.winner_id;
        if (!targetUserId) return Response.json({ error: 'A target userId is required' }, { status: 400 });
        const amount = Number(payload.amount) > 0 ? Number(payload.amount) : (match.wager_amount || 0) * 2 * 0.9;

        const entry = await applyBalanceHold(base44, {
          userId: targetUserId, amount, direction: 'hold', matchId: match.id, admin, triggerEvent: 'investigation_hold',
        });

        actionType = 'hold_placed';
        caseUpdates.hold_status = 'post_settlement_hold';
        caseUpdates.held_amount = amount;
        caseUpdates.hold_target_user_id = targetUserId;
        caseUpdates.hold_ledger_entry_ids = [...(disputeCase.hold_ledger_entry_ids || []), entry.id];
        caseUpdates.hold_placed_at = new Date().toISOString();
        noteContent = noteContent || `Post-settlement hold placed: $${amount.toFixed(2)} moved from Available to Held Balance pending investigation.`;
        break;
      }
      case 'place_account_hold': {
        const targetUserId = payload.userId || disputeCase.reported_user_id;
        if (!targetUserId) return Response.json({ error: 'A target userId is required' }, { status: 400 });
        const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: targetUserId });
        const wallet = wallets[0];
        const amount = wallet?.available_balance || 0;

        let entry = null;
        if (amount > 0) {
          entry = await applyBalanceHold(base44, {
            userId: targetUserId, amount, direction: 'hold', matchId: disputeCase.match_id, admin, triggerEvent: 'account_restriction',
          });
        }
        await base44.asServiceRole.entities.User.update(targetUserId, { account_state: 'suspended' });

        actionType = 'account_restricted';
        caseUpdates.hold_status = 'account_hold';
        caseUpdates.held_amount = amount;
        caseUpdates.hold_target_user_id = targetUserId;
        if (entry) caseUpdates.hold_ledger_entry_ids = [...(disputeCase.hold_ledger_entry_ids || []), entry.id];
        caseUpdates.hold_placed_at = new Date().toISOString();
        noteContent = noteContent || `Account-level restriction applied: contest participation and withdrawals suspended${amount > 0 ? `; $${amount.toFixed(2)} moved to Held Balance` : ''} pending investigation.`;
        break;
      }
      case 'release_hold': {
        if (!disputeCase.hold_status || disputeCase.hold_status === 'none' || disputeCase.hold_status === 'released') {
          return Response.json({ error: 'This case has no active hold to release' }, { status: 400 });
        }
        if (disputeCase.hold_status === 'pre_settlement_hold') {
          if (disputeCase.match_id) {
            const match = await base44.asServiceRole.entities.Match.get(disputeCase.match_id);
            if (match) await base44.asServiceRole.entities.Match.update(match.id, { settlement_hold: false });
          }
          if (disputeCase.game_id) {
            await base44.asServiceRole.functions.invoke('settleMatch', { gameId: disputeCase.game_id }).catch(() => {});
          }
          noteContent = noteContent || 'Pre-settlement hold released — settlement resumed.';
        } else {
          const targetUserId = disputeCase.hold_target_user_id;
          const amount = disputeCase.held_amount || 0;
          if (targetUserId && amount > 0) {
            const entry = await applyBalanceHold(base44, {
              userId: targetUserId, amount, direction: 'release', matchId: disputeCase.match_id, admin, triggerEvent: 'investigation_hold_release',
            });
            caseUpdates.hold_ledger_entry_ids = [...(disputeCase.hold_ledger_entry_ids || []), entry.id];
          }
          noteContent = noteContent || 'Financial hold released — funds returned to Available Balance.';
        }
        actionType = 'hold_released';
        caseUpdates.hold_status = 'released';
        caseUpdates.hold_released_at = new Date().toISOString();
        break;
      }

      case 'refer_case': {
        if (!payload.referralDestination) return Response.json({ error: 'referralDestination is required' }, { status: 400 });
        caseUpdates.referral_destination = payload.referralDestination;
        caseUpdates.referral_reference_number = payload.referralReferenceNumber || '';
        caseUpdates.referred_at = new Date().toISOString();
        caseUpdates.referred_by_admin_id = admin.id;
        actionType = 'referred';
        noteContent = noteContent || `Case referred to ${payload.referralDestination.replace(/_/g, ' ')}.`;
        break;
      }

      // --- Formal Case Resolution — the only path to a terminal status ---
      case 'resolve_case': {
        const resolutionType = payload.resolutionType;
        if (!VALID_RESOLUTION_TYPES.includes(resolutionType)) {
          return Response.json({ error: 'Invalid resolutionType' }, { status: 400 });
        }
        if (!payload.internalRationale || !payload.internalRationale.trim()) {
          return Response.json({ error: 'internalRationale is required' }, { status: 400 });
        }

        const match = disputeCase.match_id ? await base44.asServiceRole.entities.Match.get(disputeCase.match_id) : null;
        const contestRecord = await findContestRecord(base44, disputeCase.match_id);

        const resolutionFields = {
          case_id: caseId,
          case_number: disputeCase.case_number,
          resolution_type: resolutionType,
          violation_found: resolutionType !== 'no_violation',
          administrator_id: admin.id,
          administrator_name: admin.full_name || admin.email || 'Admin',
          resolution_timestamp: new Date().toISOString(),
          internal_rationale: payload.internalRationale.trim(),
          admin_notes: payload.adminNotes || '',
          user_facing_summary: payload.userFacingSummary || '',
          target_user_id: payload.targetUserId || '',
        };

        let effectsSummary = '';

        if (resolutionType === 'no_violation') {
          if (disputeCase.hold_status && !['none', 'released'].includes(disputeCase.hold_status)) {
            if (disputeCase.hold_status === 'pre_settlement_hold') {
              if (match) await base44.asServiceRole.entities.Match.update(match.id, { settlement_hold: false });
              if (disputeCase.game_id) {
                await base44.asServiceRole.functions.invoke('settleMatch', { gameId: disputeCase.game_id }).catch(() => {});
              }
            } else if (disputeCase.hold_target_user_id && disputeCase.held_amount > 0) {
              const entry = await applyBalanceHold(base44, {
                userId: disputeCase.hold_target_user_id, amount: disputeCase.held_amount, direction: 'release',
                matchId: disputeCase.match_id, admin, triggerEvent: 'investigation_hold_release',
              });
              caseUpdates.hold_ledger_entry_ids = [...(disputeCase.hold_ledger_entry_ids || []), entry.id];
            }
            caseUpdates.hold_status = 'released';
            caseUpdates.hold_released_at = new Date().toISOString();
          }
          effectsSummary = 'No violation was found. Any temporary hold has been released and the contest result stands.';
        } else if (resolutionType === 'contest_reversed') {
          if (!match || match.status !== 'completed' || !contestRecord) {
            return Response.json({ error: 'Contest reversal requires a settled contest' }, { status: 400 });
          }
          const feeTreatment = payload.feeTreatment === 'refunded' ? 'refunded' : 'retained';
          const winnerId = contestRecord.winner_id;
          const loserId = contestRecord.loser_id;
          const payout = contestRecord.winner_payout || 0;
          const entryAmount = contestRecord.entry_amount || 0;
          const fee = contestRecord.platform_fee || 0;
          const holdCoversThis = disputeCase.hold_status === 'post_settlement_hold' && disputeCase.hold_target_user_id === winnerId;

          const legs = [];
          if (winnerId && payout > 0) {
            legs.push({ ledgerAccount: 'user_account', userId: winnerId, debit: payout, credit: 0, fromHeld: holdCoversThis, transactionType: 'reversal' });
          }
          if (loserId && entryAmount > 0) {
            legs.push({ ledgerAccount: 'user_account', userId: loserId, debit: 0, credit: entryAmount, transactionType: 'reversal' });
          }
          let contestClearingNet = payout - entryAmount;
          if (feeTreatment === 'refunded' && fee > 0) {
            legs.push({ ledgerAccount: 'platform_revenue', debit: fee, credit: 0, transactionType: 'reversal' });
            contestClearingNet -= fee;
          }
          if (contestClearingNet > 0) legs.push({ ledgerAccount: 'contest_clearing', debit: 0, credit: contestClearingNet, transactionType: 'reversal' });
          else if (contestClearingNet < 0) legs.push({ ledgerAccount: 'contest_clearing', debit: -contestClearingNet, credit: 0, transactionType: 'reversal' });

          const entries = await postRemedyLegs(base44, { matchId: match.id, admin, triggerEvent: 'contest_reversal', legs });

          if (holdCoversThis) {
            caseUpdates.hold_status = 'released';
            caseUpdates.hold_released_at = new Date().toISOString();
          }
          await updatePlayerStatsDelta(base44, winnerId, 'win');
          await updatePlayerStatsDelta(base44, loserId, 'loss');

          resolutionFields.fee_treatment = feeTreatment;
          resolutionFields.target_user_id = winnerId || '';
          resolutionFields.reversal_ledger_entry_ids = entries.map((e) => e.id);
          effectsSummary = `The contest result has been reversed. $${payout.toFixed(2)} was debited from the original winner and $${entryAmount.toFixed(2)} was refunded to the original loser. Platform fee ${feeTreatment}.`;
        } else if (resolutionType === 'contest_voided') {
          const entries = [];
          if (match && match.status === 'completed' && contestRecord) {
            const winnerId = contestRecord.winner_id;
            const loserId = contestRecord.loser_id;
            const payout = contestRecord.winner_payout || 0;
            const entryAmount = contestRecord.entry_amount || 0;
            const fee = contestRecord.platform_fee || 0;
            const holdCoversThis = disputeCase.hold_status === 'post_settlement_hold' && disputeCase.hold_target_user_id === winnerId;

            const legs = [];
            if (winnerId) legs.push({ ledgerAccount: 'user_account', userId: winnerId, debit: payout, credit: entryAmount, fromHeld: holdCoversThis, transactionType: 'reversal' });
            if (loserId) legs.push({ ledgerAccount: 'user_account', userId: loserId, debit: 0, credit: entryAmount, transactionType: 'reversal' });
            if (fee > 0) legs.push({ ledgerAccount: 'platform_revenue', debit: fee, credit: 0, transactionType: 'reversal' });
            const contestClearingNet = payout - entryAmount * 2 - fee;
            if (contestClearingNet > 0) legs.push({ ledgerAccount: 'contest_clearing', debit: 0, credit: contestClearingNet, transactionType: 'reversal' });
            else if (contestClearingNet < 0) legs.push({ ledgerAccount: 'contest_clearing', debit: -contestClearingNet, credit: 0, transactionType: 'reversal' });

            entries.push(...(await postRemedyLegs(base44, { matchId: match.id, admin, triggerEvent: 'contest_void', legs })));
            if (holdCoversThis) {
              caseUpdates.hold_status = 'released';
              caseUpdates.hold_released_at = new Date().toISOString();
            }
            await updatePlayerStatsDelta(base44, winnerId, 'win');
            await updatePlayerStatsDelta(base44, loserId, 'loss');
            await base44.asServiceRole.entities.Match.update(match.id, { result: 'cancelled' });
          } else if (match) {
            // Not yet settled — simply refund each player's escrowed entry hold.
            for (const playerId of [match.player1_id, match.player2_id].filter(Boolean)) {
              const entry = await applyBalanceHold(base44, {
                userId: playerId, amount: match.wager_amount || 0, direction: 'release',
                matchId: match.id, admin, triggerEvent: 'contest_void',
              });
              if (entry) entries.push(entry);
            }
            if (disputeCase.hold_status === 'pre_settlement_hold') {
              caseUpdates.hold_status = 'released';
              caseUpdates.hold_released_at = new Date().toISOString();
            }
            await base44.asServiceRole.entities.Match.update(match.id, { status: 'cancelled', result: 'cancelled', settlement_hold: false });
          }

          resolutionFields.void_ledger_entry_ids = entries.map((e) => e.id);
          effectsSummary = "The contest has been voided. Both players' entry amounts have been refunded and no statistics were awarded.";
        } else if (resolutionType === 'account_suspended') {
          if (!payload.targetUserId) return Response.json({ error: 'targetUserId is required' }, { status: 400 });
          await base44.asServiceRole.entities.User.update(payload.targetUserId, { account_state: 'suspended' });
          resolutionFields.suspension_scope = payload.suspensionScope || ['contest_participation', 'withdrawals'];
          resolutionFields.suspension_duration_type = payload.suspensionDurationType || 'temporary';
          if (payload.suspensionExpiresAt) resolutionFields.suspension_expires_at = payload.suspensionExpiresAt;
          effectsSummary = 'The account associated with this case has been suspended.';
        } else if (resolutionType === 'account_closed') {
          if (!payload.targetUserId) return Response.json({ error: 'targetUserId is required' }, { status: 400 });
          await base44.asServiceRole.entities.User.update(payload.targetUserId, { account_state: 'closed' });
          resolutionFields.closure_reason = payload.closureReason || '';
          effectsSummary = 'The account associated with this case has been permanently closed.';
        } else if (resolutionType === 'funds_forfeited') {
          // Data-model only, per policy — never automated until the legal
          // framework is finalized. No funds are moved by this branch.
          resolutionFields.forfeiture_amount = Number(payload.forfeitureAmount) || 0;
          resolutionFields.forfeiture_legal_reference = payload.forfeitureLegalReference || '';
          effectsSummary = 'A funds forfeiture has been recorded for legal/compliance reference. No funds were automatically moved.';
        } else if (resolutionType === 'referred') {
          resolutionFields.referral_destination = payload.referralDestination || '';
          resolutionFields.referral_reference_number = payload.referralReferenceNumber || '';
          effectsSummary = 'This case has been referred for external review.';
        }

        await base44.asServiceRole.entities.CaseResolution.create(resolutionFields);

        caseUpdates.status = 'resolved';
        caseUpdates.resolution = payload.userFacingSummary || effectsSummary;
        caseUpdates.resolution_timestamp = resolutionFields.resolution_timestamp;
        caseUpdates.violation_found = resolutionFields.violation_found;
        caseUpdates.resolution_type = resolutionType;

        actionType = 'resolved';
        previousStatus = disputeCase.status;
        newStatus = 'resolved';
        noteContent = `Case resolved: ${resolutionType.replace(/_/g, ' ')}. ${effectsSummary}`;
        visibleToUser = false; // internal audit note; the user sees case.resolution + gets emailed a clean summary

        if (contestRecord) {
          await base44.asServiceRole.entities.ContestRecordAnnotation.create({
            contest_record_id: contestRecord.id,
            annotation_type: 'investigation_outcome',
            content: `Dispute Case #${fmtCase(disputeCase.case_number)} resolved: ${resolutionType}. ${effectsSummary} Resolved ${resolutionFields.resolution_timestamp}.`,
            admin_id: admin.id,
            admin_name: admin.full_name || admin.email || 'Admin',
          }).catch(() => {});
        }

        // Notify affected users — registered users only, no internal details.
        const notifyIds = [...new Set([disputeCase.reporting_user_id, disputeCase.reported_user_id].filter(Boolean))];
        for (const uid of notifyIds) {
          const u = await base44.asServiceRole.entities.User.get(uid).catch(() => null);
          if (u?.email) {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: u.email,
              subject: `ChessBet Case #${fmtCase(disputeCase.case_number)} — Investigation Complete`,
              body: `Your case (Case #${fmtCase(disputeCase.case_number)}) has been reviewed.\n\nOutcome: ${resolutionFields.violation_found ? 'A violation was found.' : 'No violation was found.'}\n${effectsSummary}\n\nIf you believe this determination was made in error, you may submit a single appeal from My Reports.`,
            }).catch(() => {});
          }
        }
        break;
      }
    }

    let updatedCase = disputeCase;
    if (Object.keys(caseUpdates).length > 0) {
      updatedCase = await base44.asServiceRole.entities.DisputeCase.update(caseId, caseUpdates);
    }

    const note = await base44.asServiceRole.entities.DisputeCaseNote.create({
      case_id: caseId,
      reporting_user_id: disputeCase.reporting_user_id,
      author_role: 'admin',
      author_id: admin.id,
      author_name: admin.full_name || admin.email || 'Admin',
      action_type: actionType,
      content: noteContent,
      previous_status: previousStatus,
      new_status: newStatus,
      visible_to_user: visibleToUser,
    });

    if (action === 'escalate') {
      base44.asServiceRole.entities.User.filter({ role: 'admin' })
        .then((admins) =>
          Promise.all(
            admins.map((a) =>
              base44.asServiceRole.integrations.Core.SendEmail({
                to: a.email,
                subject: `Dispute Case #${fmtCase(disputeCase.case_number)} Escalated`,
                body: `Case #${fmtCase(disputeCase.case_number)} has been escalated and marked high priority.\n\n${noteContent}`,
              }).catch(() => {})
            )
          )
        )
        .catch(() => {});
    }

    return Response.json({ case: updatedCase, note });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});