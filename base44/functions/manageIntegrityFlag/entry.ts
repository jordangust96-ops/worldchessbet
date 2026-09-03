import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { requireAdminMfa } from '../../shared/mfa.ts';
import { applyBalanceHold } from '../../shared/ledger.ts';

// Admin-only actions on an existing IntegrityFlag. Every action writes an
// immutable IntegrityAuditLog entry. No action here ever automatically bans
// or suspends a user — freezing withdrawals only sets a hold flag that an
// admin must explicitly apply and later lift.
const VALID_ACTIONS = [
  'mark_under_review',
  'mark_cleared',
  'mark_action_taken',
  'add_notes',
  'freeze_withdrawals',
  'unfreeze_withdrawals',
  'request_identity_verification',
  'open_case',
];

// Releases this flag's match's pending-winnings hold (settleMatch /
// releasePendingWinnings) to Available Balance, if one is still held and no
// other open case or fair-play/reconciliation flag on the match is also
// blocking it. Used when a flag that was itself holding a payout (an
// autonomous, unreported Fair Play flag — see releasePendingWinnings) is
// cleared without a case ever being opened — otherwise those funds would
// stay held indefinitely with nothing left to release them.
async function releaseMatchPendingPayoutIfUnblocked(base44, { matchId, admin }) {
  if (!matchId) return;
  const payoutTransactions = await base44.asServiceRole.entities.WalletTransaction.filter({ match_id: matchId, type: 'payout' });
  const pendingPayout = payoutTransactions.find((t) => t.payout_hold_status === 'held');
  if (!pendingPayout) return;

  const [cases, flags] = await Promise.all([
    base44.asServiceRole.entities.DisputeCase.filter({ match_id: matchId }),
    base44.asServiceRole.entities.IntegrityFlag.filter({ match_id: matchId, user_id: pendingPayout.user_id }),
  ]);
  if (cases.some((c) => !['resolved', 'closed'].includes(c.status))) return;
  if (
    flags.some(
      (f) =>
        ['open', 'under_review'].includes(f.status) &&
        (f.flag_type === 'settlement_reconciliation_required' ||
          (f.flag_type === 'engine_assistance_suspected' && f.severity !== 'low'))
    )
  ) {
    return;
  }

  await applyBalanceHold(base44, {
    userId: pendingPayout.user_id, amount: pendingPayout.amount, direction: 'release',
    matchId, actor: 'administrator', actorId: admin.id, triggerEvent: 'pending_winnings_release',
  });
  await base44.asServiceRole.entities.WalletTransaction.update(pendingPayout.id, { payout_hold_status: 'released' });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    const body = await req.json();
    const mfaError = await requireAdminMfa(base44, admin, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;

    const { flagId, action, notes } = body;
    if (!flagId || !VALID_ACTIONS.includes(action)) {
      return Response.json({ error: 'A valid flagId and action are required' }, { status: 400 });
    }

    const flag = await base44.asServiceRole.entities.IntegrityFlag.get(flagId);
    if (!flag) return Response.json({ error: 'Flag not found' }, { status: 404 });

    if (
      flag.flag_type === 'settlement_reconciliation_required' &&
      ['mark_cleared', 'mark_action_taken'].includes(action)
    ) {
      const match = flag.match_id
        ? await base44.asServiceRole.entities.Match.get(flag.match_id).catch(() => null)
        : null;
      if (!match || !['completed', 'cancelled'].includes(match.status)) {
        return Response.json({
          error: 'Financial settlement alerts cannot be cleared while the linked contest remains unresolved. Use Reconcile & Complete or keep the item under review.',
        }, { status: 409 });
      }
    }

    const previousStatus = flag.status;
    let newStatus = previousStatus;
    const flagUpdates = { assigned_admin_id: admin.id };
    let notifyUser = null;
    let auditNotes = notes;

    if (action === 'mark_under_review') {
      newStatus = 'under_review';
      flagUpdates.status = newStatus;
    } else if (action === 'mark_cleared') {
      newStatus = 'cleared';
      flagUpdates.status = newStatus;
    } else if (action === 'open_case') {
      if (!flag.match_id) return Response.json({ error: 'This flag has no linked match' }, { status: 400 });
      const match = await base44.asServiceRole.entities.Match.get(flag.match_id);
      if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

      const existingCases = await base44.asServiceRole.entities.DisputeCase.filter({ match_id: flag.match_id });
      const openExisting = existingCases.find((c) => !['resolved', 'closed'].includes(c.status));
      if (openExisting) {
        return Response.json({
          error: `An open case already exists for this match (Case #CB-${String(openExisting.case_number).padStart(6, '0')})`,
        }, { status: 409 });
      }

      const [game, contestRecords, ledgerEntries, walletTransactions, flaggedUser] = await Promise.all([
        match.game_id ? base44.asServiceRole.entities.Game.get(match.game_id).catch(() => null) : Promise.resolve(null),
        base44.asServiceRole.entities.ContestRecord.filter({ match_id: flag.match_id }),
        base44.asServiceRole.entities.LedgerEntry.filter({ match_id: flag.match_id }),
        base44.asServiceRole.entities.WalletTransaction.filter({ match_id: flag.match_id }),
        base44.asServiceRole.entities.User.get(flag.user_id).catch(() => null),
      ]);
      const contestRecord = contestRecords[0] || null;
      const flaggedName = flaggedUser?.full_name || flaggedUser?.email || 'Player';
      const ledgerEntryIds = contestRecord?.ledger_entry_ids || ledgerEntries.map((e) => e.id);
      const walletTransactionIds = contestRecord?.wallet_transaction_ids || walletTransactions.map((t) => t.id);

      const [latest] = await base44.asServiceRole.entities.DisputeCase.list('-case_number', 1);
      const caseNumber = (latest?.case_number || 1000) + 1;
      const reportDescription = `Case opened by ${admin.full_name || admin.email || 'an administrator'} from Integrity Flag ${flagId} (${flag.flag_type}, severity ${flag.severity}). No player report was filed for this contest. ${flag.notes || ''}`.trim().slice(0, 4000);

      // DisputeCase RLS restricts direct creation to admins reviewing their
      // own filed report; this is the one path that opens a case with no
      // reporting player at all — an admin converting an autonomous Fair
      // Play/integrity flag into a formal case so the existing hold/remedy
      // tooling in manageDisputeCase (holds, reversal, void) becomes
      // available for it. The admin stands in as reporting_user_id since the
      // field is required and there is no player report to attribute this to.
      const disputeCase = await base44.asServiceRole.entities.DisputeCase.create({
        case_number: caseNumber,
        status: 'open',
        priority: flag.severity === 'high' ? 'high' : 'medium',
        report_category: 'fair_play',
        report_subcategory: 'Automated Fair Play Screening',
        report_description: reportDescription,
        attachments: [],
        match_id: flag.match_id,
        game_id: game?.id || match.game_id || '',
        contest_record_id: contestRecord?.id || '',
        reporting_user_id: admin.id,
        reported_user_id: flag.user_id,
        reporting_user_username: admin.full_name || admin.email || 'Admin',
        reported_user_username: flaggedName,
        time_control: match.time_control || '',
        display_name: match.display_name || '',
        entry_amount: match.wager_amount || 0,
        is_private: !!match.is_private,
        pgn: game?.pgn || contestRecord?.pgn || '',
        final_fen: game?.fen || contestRecord?.final_fen || '',
        outcome_type: game?.end_reason || contestRecord?.outcome_type || '',
        winner_id: game?.winner_id || contestRecord?.winner_id || '',
        contest_status: match.status || '',
        ledger_entry_ids: ledgerEntryIds,
        wallet_transaction_ids: walletTransactionIds,
        hold_status: 'none',
        held_amount: 0,
        escalated: flag.severity === 'high',
        fair_play_review_flag: true,
        aml_review_flag: false,
        manual_settlement_review_flag: false,
      });

      await base44.asServiceRole.entities.DisputeCaseNote.create({
        case_id: disputeCase.id,
        reporting_user_id: admin.id,
        author_id: admin.id,
        author_name: admin.full_name || admin.email || 'Admin',
        author_role: 'admin',
        action_type: 'case_created',
        content: `Case opened from Integrity Flag ${flagId} (${flag.flag_type}, severity ${flag.severity}). No player report was filed for this contest.`,
        visible_to_user: false,
      });

      const evidence = await base44.asServiceRole.entities.CaseEvidence.create({
        case_id: disputeCase.id,
        case_number: caseNumber,
        match_id: flag.match_id,
        game_id: game?.id || match.game_id || '',
        contest_record_id: contestRecord?.id || '',
        pgn: game?.pgn || contestRecord?.pgn || '',
        move_log: game?.move_log || contestRecord?.move_log || [],
        final_fen: game?.fen || contestRecord?.final_fen || '',
        ledger_entry_ids: ledgerEntryIds,
        wallet_transaction_ids: walletTransactionIds,
        winner_id: contestRecord?.winner_id || '',
        loser_id: contestRecord?.loser_id || '',
        winner_payout: contestRecord?.winner_payout || 0,
        platform_fee: contestRecord?.platform_fee || 0,
        contest_pool: contestRecord?.contest_pool || 0,
        settlement_timestamp: contestRecord?.settlement_timestamp || '',
        report_category: 'fair_play',
        report_subcategory: 'Automated Fair Play Screening',
        report_description: reportDescription,
        captured_at: new Date().toISOString(),
        legal_hold: false,
      });
      await base44.asServiceRole.entities.DisputeCase.update(disputeCase.id, { evidence_id: evidence.id });

      newStatus = 'under_review';
      flagUpdates.status = newStatus;
      auditNotes = auditNotes || `Opened Dispute Case #CB-${String(caseNumber).padStart(6, '0')} from this flag.`;
    } else if (action === 'mark_action_taken') {
      newStatus = 'action_taken';
      flagUpdates.status = newStatus;
      if (notes) flagUpdates.action_taken = notes;
    } else if (action === 'add_notes') {
      flagUpdates.notes = flag.notes ? `${flag.notes}\n\n${notes}` : notes;
    } else if (action === 'freeze_withdrawals') {
      await base44.asServiceRole.entities.User.update(flag.user_id, { withdrawal_hold: true });
      notifyUser = {
        subject: 'ChessBet Account Notice',
        body: 'A temporary hold has been placed on withdrawals from your ChessBet account while we complete a routine integrity review. This is not a suspension, and your account remains otherwise active. We will notify you once the review is complete.',
      };
    } else if (action === 'unfreeze_withdrawals') {
      await base44.asServiceRole.entities.User.update(flag.user_id, { withdrawal_hold: false });
    } else if (action === 'request_identity_verification') {
      await base44.asServiceRole.entities.User.update(flag.user_id, { identity_verification_status: 'pending' });
      notifyUser = {
        subject: 'ChessBet Identity Verification Requested',
        body: 'As part of a routine account review, ChessBet is requesting additional identity verification. Please contact ChessBet Support to complete this step.',
      };
    }

    const updatedFlag = await base44.asServiceRole.entities.IntegrityFlag.update(flagId, flagUpdates);

    await base44.asServiceRole.entities.IntegrityAuditLog.create({
      flag_id: flagId,
      admin_id: admin.id,
      admin_name: admin.full_name || admin.email,
      action,
      previous_status: previousStatus,
      new_status: newStatus,
      notes: auditNotes || '',
    });

    if (notifyUser) {
      const targetUser = await base44.asServiceRole.entities.User.get(flag.user_id);
      if (targetUser?.email) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: targetUser.email,
          subject: notifyUser.subject,
          body: notifyUser.body,
        }).catch(() => {});
      }
    }

    return Response.json({ flag: updatedFlag });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});