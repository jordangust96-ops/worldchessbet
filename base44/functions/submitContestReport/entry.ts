import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const VALID_CATEGORIES = ['fair_play', 'collusion', 'harassment', 'technical_issue', 'rules_violation', 'other'];

// Formal Report Intake — player-facing entry point for the Contest Reporting
// framework. Every submission is auto-assigned a permanent Case ID, snapshots
// everything the platform already knows about the contest into an immutable
// evidence package, enters the administrator investigation queue with status
// "open", and is immediately confirmed to the reporting player. This
// function NEVER touches contest outcomes or balances — no financial hold is
// ever placed automatically by filing a report. Holds and formal resolutions
// are exclusively administrator actions (see manageDisputeCase).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { matchId, gameId, category, subcategory, description } = await req.json();
    if (!matchId) return Response.json({ error: 'matchId is required' }, { status: 400 });
    if (!VALID_CATEGORIES.includes(category)) {
      return Response.json({ error: 'Invalid report category' }, { status: 400 });
    }
    if (!description || !description.trim()) {
      return Response.json({ error: 'A description is required' }, { status: 400 });
    }

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
    if (match.player1_id !== user.id && match.player2_id !== user.id) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    const opponentId = match.player1_id === user.id ? match.player2_id : match.player1_id;

    const [game, contestRecords, ledgerEntries, walletTransactions, reportingUser, reportedUser] = await Promise.all([
      gameId ? base44.asServiceRole.entities.Game.get(gameId).catch(() => null) : Promise.resolve(null),
      base44.asServiceRole.entities.ContestRecord.filter({ match_id: matchId }),
      base44.asServiceRole.entities.LedgerEntry.filter({ match_id: matchId }),
      base44.asServiceRole.entities.WalletTransaction.filter({ match_id: matchId }),
      base44.asServiceRole.entities.User.get(user.id).catch(() => null),
      opponentId ? base44.asServiceRole.entities.User.get(opponentId).catch(() => null) : Promise.resolve(null),
    ]);
    const contestRecord = contestRecords[0] || null;

    // Sequential, permanent Case ID.
    const [latest] = await base44.asServiceRole.entities.DisputeCase.list('-case_number', 1);
    const caseNumber = (latest?.case_number || 1000) + 1;

    const ledgerEntryIds = contestRecord?.ledger_entry_ids || ledgerEntries.map((e) => e.id);
    const walletTransactionIds = contestRecord?.wallet_transaction_ids || walletTransactions.map((t) => t.id);
    const reportingName = reportingUser?.full_name || reportingUser?.email || 'Player';
    const reportedName = reportedUser?.full_name || reportedUser?.email || '';

    // DisputeCase RLS restricts direct creation to admins, so the case is
    // created here with the service role on the reporting user's behalf —
    // reporting_user_id (not created_by_id) is what RLS uses to let them
    // read back their own case.
    const disputeCase = await base44.asServiceRole.entities.DisputeCase.create({
      case_number: caseNumber,
      status: 'open', // Investigation Queue — every report enters here automatically
      priority: 'medium',
      report_category: category,
      report_subcategory: subcategory || '',
      report_description: description.trim(),
      attachments: [],
      match_id: matchId,
      game_id: game?.id || match.game_id || '',
      contest_record_id: contestRecord?.id || '',
      reporting_user_id: user.id,
      reported_user_id: opponentId || '',
      reporting_user_username: reportingName,
      reported_user_username: reportedName,
      time_control: match.time_control || '',
      display_name: match.display_name || '',
      entry_amount: match.wager_amount || 0,
      is_private: !!match.is_private,
      pgn: game?.pgn || contestRecord?.pgn || '',
      final_fen: game?.fen || contestRecord?.final_fen || '',
      outcome_type: game?.end_reason || contestRecord?.outcome_type || '',
      winner_id: game?.winner_id || contestRecord?.winner_id || '',
      contest_status: match.status || '', // snapshot of contest status at intake
      ledger_entry_ids: ledgerEntryIds,
      wallet_transaction_ids: walletTransactionIds,
      hold_status: 'none',
      held_amount: 0,
      escalated: false,
      fair_play_review_flag: false,
      aml_review_flag: false,
      manual_settlement_review_flag: false,
    });

    // Append-only audit trail — first entry, visible to the reporting user
    // (their own submission).
    await base44.asServiceRole.entities.DisputeCaseNote.create({
      case_id: disputeCase.id,
      reporting_user_id: user.id,
      author_id: user.id,
      author_name: reportingName,
      author_role: 'user',
      action_type: 'case_created',
      content: 'Report submitted.',
      visible_to_user: true,
    });

    // Immutable Evidence Package — assembled once, at intake, from everything
    // the platform already knows about this contest. Never edited afterward;
    // future evidence (screenshots, fair-play analysis, etc.) can only be
    // attached via its dedicated future-ready fields, never by altering these
    // captured values.
    const evidence = await base44.asServiceRole.entities.CaseEvidence.create({
      case_id: disputeCase.id,
      case_number: caseNumber,
      match_id: matchId,
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
      report_category: category,
      report_subcategory: subcategory || '',
      report_description: description.trim(),
      captured_at: new Date().toISOString(),
      legal_hold: false,
    });
    await base44.asServiceRole.entities.DisputeCase.update(disputeCase.id, { evidence_id: evidence.id });

    // Append-only, immutable-Contest-Record-preserving link — only created
    // when the contest has already settled into a ContestRecord.
    if (contestRecord) {
      await base44.asServiceRole.entities.ContestRecordAnnotation.create({
        contest_record_id: contestRecord.id,
        annotation_type: 'dispute',
        content: `Dispute Case #CB-${String(caseNumber).padStart(6, '0')} filed by ${reportingName} (${category}${subcategory ? ' / ' + subcategory : ''}). Hold status: none. Status: open.`,
        admin_id: '',
        admin_name: 'System',
      }).catch(() => {});
    }

    // Best-effort admin notification — never blocks the report submission.
    base44.asServiceRole.entities.User.filter({ role: 'admin' })
      .then((admins) =>
        Promise.all(
          admins.map((a) =>
            base44.asServiceRole.integrations.Core.SendEmail({
              to: a.email,
              subject: `New Dispute Case #CB-${String(caseNumber).padStart(6, '0')} Filed`,
              body: `A new contest report has been filed.\n\nCase #CB-${String(caseNumber).padStart(6, '0')}\nCategory: ${category}${subcategory ? ' / ' + subcategory : ''}\nMatch ID: ${matchId}\n\nReview it in the admin dashboard under Disputes.`,
            }).catch(() => {})
          )
        )
      )
      .catch(() => {});

    return Response.json({
      caseNumber,
      caseId: disputeCase.id,
      confirmation: `Your report has been received and assigned Case #CB-${String(caseNumber).padStart(6, '0')}. Our Trust & Safety team will review the information and contact you if additional details are required.`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});