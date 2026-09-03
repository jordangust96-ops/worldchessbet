import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { requireAdminMfa } from '../../shared/mfa.ts';

const ACTIVE_FLAG_STATUSES = ['open', 'under_review'];
const SETTLEMENT_TYPES = ['payout', 'wager_refund', 'wager_forfeit', 'service_fee_refund'];
const SETTLEMENT_EVENTS = ['match_settlement', 'match_settlement_draw', 'service_fee_refund'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    const body = await req.json();
    const mfaError = await requireAdminMfa(base44, admin, body?.mfaSessionToken, req.headers.get('user-agent') || '');
    if (mfaError) return mfaError;

    const { flagId } = body;
    if (!flagId) return Response.json({ error: 'flagId is required' }, { status: 400 });

    const flag = await base44.asServiceRole.entities.IntegrityFlag.get(flagId);
    if (!flag || flag.flag_type !== 'settlement_reconciliation_required' || !flag.match_id) {
      return Response.json({ error: 'A settlement reconciliation flag is required' }, { status: 400 });
    }

    let match = await base44.asServiceRole.entities.Match.get(flag.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const games = await base44.asServiceRole.entities.Game.filter({ match_id: match.id }, '-created_date', 1);
    const game = match.game_id
      ? await base44.asServiceRole.entities.Game.get(match.game_id).catch(() => games[0] || null)
      : games[0] || null;
    if (!game || game.status !== 'completed') {
      return Response.json({ error: 'The authoritative Game is not completed' }, { status: 409 });
    }

    const allFlags = await base44.asServiceRole.entities.IntegrityFlag.filter({
      match_id: match.id,
      flag_type: 'settlement_reconciliation_required',
    }, 'created_date', 50);

    const resolveFlags = async (note) => {
      const unresolved = allFlags.filter((row) => ACTIVE_FLAG_STATUSES.includes(row.status));
      if (unresolved.length) {
        await base44.asServiceRole.entities.IntegrityFlag.bulkUpdate(
          unresolved.map((row) => ({
            id: row.id,
            status: 'action_taken',
            assigned_admin_id: admin.id,
            action_taken: note,
          }))
        );
        await base44.asServiceRole.entities.IntegrityAuditLog.bulkCreate(
          unresolved.map((row) => ({
            flag_id: row.id,
            admin_id: admin.id,
            admin_name: admin.full_name || admin.email,
            action: 'mark_action_taken',
            previous_status: row.status,
            new_status: 'action_taken',
            notes: note,
          }))
        );
      }
    };

    if (match.status === 'completed') {
      await resolveFlags('Verified the Match was already completed and its settlement alert is no longer actionable.');
      return Response.json({ alreadyResolved: true, match });
    }

    const [transactions, ledgerEntries, wallets, clearingAccounts] = await Promise.all([
      base44.asServiceRole.entities.WalletTransaction.filter({ match_id: match.id }, 'created_date', 100),
      base44.asServiceRole.entities.LedgerEntry.filter({ match_id: match.id }, 'created_date', 200),
      Promise.all([match.player1_id, match.player2_id].filter(Boolean).map(async (userId) => {
        const rows = await base44.asServiceRole.entities.Wallet.filter({ user_id: userId });
        return rows[0] || null;
      })),
      base44.asServiceRole.entities.SystemLedgerAccount.filter({ account_name: 'contest_clearing' }),
    ]);

    const settlementTransactions = transactions.filter((row) =>
      SETTLEMENT_TYPES.includes(row.type) && row.status !== 'failed'
    );
    const settlementLedgerEntries = ledgerEntries.filter((row) => SETTLEMENT_EVENTS.includes(row.trigger_event));
    const orphanTransactions = settlementTransactions.filter((row) => !row.ledger_group_id && !row.processed_at);

    if (settlementLedgerEntries.length) {
      return Response.json({ error: 'Settlement ledger entries already exist; automated reconciliation is not safe' }, { status: 409 });
    }
    // A decisive settlement now creates up to two WalletTransaction rows
    // before any ledger posting — the winner's payout and the loser's
    // forfeiture — elected and completed together in one posting call. A
    // crashed attempt may have stopped after creating just one of them, or
    // both; either is safe to retry from scratch as long as every settlement
    // transaction found is still fully orphaned (no ledger group, never
    // processed). Anything else means something already posted partially in
    // a way this automated path cannot safely reason about.
    if (
      settlementTransactions.length === 0 ||
      settlementTransactions.length > 2 ||
      settlementTransactions.length !== orphanTransactions.length
    ) {
      return Response.json({ error: 'Expected only unposted settlement transactions' }, { status: 409 });
    }

    const reservePerPlayer = Number(match.wager_amount || 0);
    const feePerPlayer = Number(match.platform_service_fee || 0);
    const totalHeldPerPlayer = reservePerPlayer + feePerPlayer;
    if (!Number.isFinite(reservePerPlayer) || reservePerPlayer <= 0 || !Number.isFinite(feePerPlayer) || feePerPlayer < 0) {
      return Response.json({ error: 'Invalid contest amounts' }, { status: 409 });
    }
    if (wallets.length !== 2 || wallets.some((wallet) => !wallet || (wallet.held_balance || 0) + 0.001 < totalHeldPerPlayer)) {
      return Response.json({ error: 'Player held-balance evidence is insufficient' }, { status: 409 });
    }

    const isDraw = game.result === 'draw' || !game.winner_id;
    if (isDraw) {
      return Response.json({ error: 'Draw reconciliation requires manual ledger review' }, { status: 409 });
    }

    const pot = reservePerPlayer * 2;
    const totalFee = feePerPlayer * 2;
    const clearingBalance = Number(clearingAccounts[0]?.balance || 0);
    const reserveShortfall = Math.max(0, Math.round((pot - clearingBalance) * 100) / 100);
    if (reserveShortfall > totalFee + 0.001) {
      return Response.json({ error: 'Reserve shortfall exceeds the disclosed service fees; manual ledger review is required' }, { status: 409 });
    }

    const reconciliationOperationId = crypto.randomUUID();
    const existingApprovals = await base44.asServiceRole.entities.SettlementReconciliation.filter({
      match_id: match.id,
      status: 'approved',
    }, '-approved_at', 5);
    if (!existingApprovals.length) {
      await base44.asServiceRole.entities.SettlementReconciliation.create({
        match_id: match.id,
        operation_id: reconciliationOperationId,
        reserve_shortfall: reserveShortfall,
        approved_by: admin.id,
        approved_at: new Date().toISOString(),
        status: 'approved',
        notes: 'Approved from the admin settlement-reconciliation workflow after orphan transaction and ledger evidence validation.',
      });
    }

    await base44.asServiceRole.entities.Match.update(match.id, {
      settlement_hold: true,
    });

    await Promise.all(orphanTransactions.map((row) => base44.asServiceRole.entities.WalletTransaction.update(row.id, {
      status: 'failed',
      integration_status: 'failed',
      source_event: 'settlement_reconciliation_abandoned',
      description: `${row.description || 'Settlement transaction'} — superseded by admin reconciliation`,
    })));

    await base44.asServiceRole.entities.Match.update(match.id, {
      status: 'in_progress',
      settlement_hold: false,
      settlement_operation_id: '',
    });

    try {
      await base44.asServiceRole.functions.invoke('settleMatch', { gameId: game.id });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'admin_settlement_reconciliation_failed',
        match_id: match.id,
        game_id: game.id,
        error: error?.response?.data?.error || error?.message || 'unknown_error',
      }));
      return Response.json({ error: 'Settlement retry failed; the reconciliation alert remains active' }, { status: 409 });
    }

    match = await base44.asServiceRole.entities.Match.get(match.id);
    if (match.status !== 'completed') {
      return Response.json({ error: 'Settlement retry did not reach completed state' }, { status: 409 });
    }

    const note = `Settlement reconciled and completed from the authoritative Game result. Approved reserve shortfall: $${reserveShortfall.toFixed(2)}; operation ${reconciliationOperationId}.`;
    await resolveFlags(note);

    return Response.json({ resolved: true, match, reserve_shortfall: reserveShortfall });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
