import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Admin-only read aggregator for the Dispute Case V2 console. Pulls together
// everything the Financial Resolution, Player Wallets, and Related User
// History panels need in one call, using the service role because Wallet and
// WalletTransaction RLS only allow a user to read their own records.
async function buildPlayerOverview(base44, userId, contestRecord) {
  if (!userId) return null;
  const [user, wallets, withdrawals, filedCases, casesAgainst, resolutions, warnings, whiteRecords, blackRecords] = await Promise.all([
    base44.asServiceRole.entities.User.get(userId).catch(() => null),
    base44.asServiceRole.entities.Wallet.filter({ user_id: userId }),
    base44.asServiceRole.entities.WalletTransaction.filter({ user_id: userId, type: 'withdrawal', status: 'completed' }),
    base44.asServiceRole.entities.DisputeCase.filter({ reporting_user_id: userId }),
    base44.asServiceRole.entities.DisputeCase.filter({ reported_user_id: userId }),
    base44.asServiceRole.entities.CaseResolution.filter({ target_user_id: userId }),
    base44.asServiceRole.entities.IntegrityFlag.filter({ user_id: userId, status: 'action_taken' }),
    base44.asServiceRole.entities.ContestRecord.filter({ white_player_id: userId }),
    base44.asServiceRole.entities.ContestRecord.filter({ black_player_id: userId }),
  ]);

  const wallet = wallets[0] || null;
  const withdrawalsAfterSettlement = !!(
    contestRecord?.settlement_timestamp &&
    withdrawals.some((w) => new Date(w.created_date) > new Date(contestRecord.settlement_timestamp))
  );

  return {
    id: userId,
    name: user?.full_name || user?.email || 'Unknown User',
    email: user?.email || '',
    accountState: user?.account_state || 'active',
    wallet: wallet
      ? { available: wallet.available_balance || 0, held: wallet.held_balance || 0, total: wallet.total_balance || 0 }
      : null,
    withdrawalsAfterSettlement,
    stats: {
      completedMatches: whiteRecords.length + blackRecords.length,
      disputesFiled: filedCases.length,
      disputesAgainst: casesAgainst.length,
      confirmedViolations: resolutions.filter((r) => r.violation_found).length,
      priorSuspensions: resolutions.filter((r) => r.resolution_type === 'account_suspended').length,
      warnings: warnings.length,
    },
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { caseId } = await req.json();
    if (!caseId) return Response.json({ error: 'caseId is required' }, { status: 400 });

    const disputeCase = await base44.asServiceRole.entities.DisputeCase.get(caseId);
    if (!disputeCase) return Response.json({ error: 'Case not found' }, { status: 404 });

    const match = disputeCase.match_id ? await base44.asServiceRole.entities.Match.get(disputeCase.match_id).catch(() => null) : null;
    const gameId = disputeCase.game_id || match?.game_id;
    const game = gameId ? await base44.asServiceRole.entities.Game.get(gameId).catch(() => null) : null;

    let contestRecord = null;
    if (disputeCase.match_id) {
      const records = await base44.asServiceRole.entities.ContestRecord.filter({ match_id: disputeCase.match_id });
      contestRecord = records[0] || null;
    }

    const ledgerEntries = disputeCase.match_id
      ? await base44.asServiceRole.entities.LedgerEntry.filter({ match_id: disputeCase.match_id }, 'created_date')
      : [];

    const contestClearingNet = ledgerEntries
      .filter((e) => e.ledger_account === 'contest_clearing')
      .reduce((sum, e) => sum + (e.credit_amount || 0) - (e.debit_amount || 0), 0);

    const [reportingPlayer, reportedPlayer] = await Promise.all([
      buildPlayerOverview(base44, disputeCase.reporting_user_id, contestRecord),
      buildPlayerOverview(base44, disputeCase.reported_user_id, contestRecord),
    ]);

    return Response.json({
      match,
      game,
      contestRecord,
      ledgerEntries,
      contestClearingNet,
      reportingPlayer,
      reportedPlayer,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});