import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const VALID_CATEGORIES = ['fair_play', 'harassment', 'technical_issue', 'rules_violation', 'other'];

// Player-facing entry point for the Contest Reporting framework. Attaches
// everything the platform already knows about the contest (players, time
// control, entry amount, move history, outcome, ledger references) so the
// reporting user only ever has to supply the category/subcategory and a
// free-form description. Never touches contest outcomes or balances —
// purely creates an internal, admin-reviewed Dispute Case.
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

    const [game, contestRecords, ledgerEntries, reportingUser, reportedUser] = await Promise.all([
      gameId ? base44.asServiceRole.entities.Game.get(gameId).catch(() => null) : Promise.resolve(null),
      base44.asServiceRole.entities.ContestRecord.filter({ match_id: matchId }),
      base44.asServiceRole.entities.LedgerEntry.filter({ match_id: matchId }),
      base44.asServiceRole.entities.User.get(user.id).catch(() => null),
      opponentId ? base44.asServiceRole.entities.User.get(opponentId).catch(() => null) : Promise.resolve(null),
    ]);
    const contestRecord = contestRecords[0] || null;

    // Sequential, human-friendly case number.
    const [latest] = await base44.asServiceRole.entities.DisputeCase.list('-case_number', 1);
    const caseNumber = (latest?.case_number || 1000) + 1;

    // Created via the user-scoped client (not asServiceRole) so created_by_id
    // is the reporting user themselves — this is what RLS relies on to let
    // them read back their own case later.
    const disputeCase = await base44.entities.DisputeCase.create({
      case_number: caseNumber,
      status: 'open',
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
      reporting_user_username: reportingUser?.full_name || reportingUser?.email || '',
      reported_user_username: reportedUser?.full_name || reportedUser?.email || '',
      time_control: match.time_control || '',
      display_name: match.display_name || '',
      entry_amount: match.wager_amount || 0,
      is_private: !!match.is_private,
      pgn: game?.pgn || contestRecord?.pgn || '',
      final_fen: game?.fen || contestRecord?.final_fen || '',
      outcome_type: game?.end_reason || contestRecord?.outcome_type || '',
      winner_id: game?.winner_id || contestRecord?.winner_id || '',
      ledger_entry_ids: contestRecord?.ledger_entry_ids || ledgerEntries.map((e) => e.id),
      wallet_transaction_ids: contestRecord?.wallet_transaction_ids || [],
      escalated: false,
      fair_play_review_flag: false,
      aml_review_flag: false,
      manual_settlement_review_flag: false,
    });

    // Append-only, immutable-Contest-Record-preserving link — only created
    // when the contest has already settled into a ContestRecord.
    if (contestRecord) {
      await base44.asServiceRole.entities.ContestRecordAnnotation.create({
        contest_record_id: contestRecord.id,
        annotation_type: 'dispute',
        content: `Dispute Case #${caseNumber} filed by ${disputeCase.reporting_user_username || 'a player'} (${category}${subcategory ? ' / ' + subcategory : ''}).`,
        admin_id: '',
        admin_name: 'System',
      }).catch(() => {});
    }

    // Best-effort admin notification — never blocks the report submission.
    base44.asServiceRole.entities.User.filter({ role: 'admin' })
      .then((admins) =>
        Promise.all(
          admins.map((admin) =>
            base44.asServiceRole.integrations.Core.SendEmail({
              to: admin.email,
              subject: `New Dispute Case #${caseNumber} Filed`,
              body: `A new contest report has been filed.\n\nCase #${caseNumber}\nCategory: ${category}${subcategory ? ' / ' + subcategory : ''}\nMatch ID: ${matchId}\n\nReview it in the admin dashboard under Disputes.`,
            }).catch(() => {})
          )
        )
      )
      .catch(() => {});

    return Response.json({ case_number: caseNumber, case_id: disputeCase.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});