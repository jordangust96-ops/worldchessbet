import { recordIntegrationEvent } from './integrationEvents.ts';

// Shared Internal Ledger posting helper, used by every backend function that
// moves money (deposits, withdrawals, contest entries/settlements, account
// closure, promotional credits, etc.). Posts a balanced set of Ledger
// entries and updates the derived Wallet / SystemLedgerAccount balances.
export async function postLedgerLegs(base44, { groupId, matchId, gameId, walletTransactionId, actor, actorId, triggerEvent, externalRefType, externalRefId, legs }) {
  const correlationId = matchId || walletTransactionId || groupId;
  if (!groupId || !Array.isArray(legs) || legs.length < 2) {
    throw new Error('Invalid ledger posting request');
  }
  for (const leg of legs) {
    for (const amount of [leg.debit || 0, leg.credit || 0, leg.heldDelta || 0]) {
      if (!Number.isFinite(amount)) throw new Error('Ledger amount must be finite');
    }
    if ((leg.debit || 0) < 0 || (leg.credit || 0) < 0) {
      throw new Error('Ledger debit and credit amounts cannot be negative');
    }
  }
  const totalDebit = legs.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = legs.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    throw new Error(`Unbalanced ledger legs: debit=${totalDebit} credit=${totalCredit}`);
  }
  const entries = [];
  for (const leg of legs) {
    if (leg.ledgerAccount === 'user_account') {
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: leg.userId });
      let wallet = wallets[0];
      if (!wallet) {
        wallet = await base44.asServiceRole.entities.Wallet.create({
          user_id: leg.userId, balance: 0, available_balance: 0, held_balance: 0, total_balance: 0,
          total_wagered: 0, total_won: 0, total_deposited: 0, total_withdrawn: 0,
        });
      }
      const newAvailable = (wallet.available_balance || 0) - (leg.debit || 0) + (leg.credit || 0);
      const newHeld = (wallet.held_balance || 0) + (leg.heldDelta || 0);
      const newTotal = newAvailable + newHeld;
      if (newAvailable < -0.001 || newHeld < -0.001 || newTotal < -0.001) {
        throw new Error('Ledger posting would create a negative user balance');
      }
      await base44.asServiceRole.entities.Wallet.update(wallet.id, {
        available_balance: newAvailable,
        held_balance: newHeld,
        total_balance: newTotal,
        balance: newAvailable,
        total_wagered: (wallet.total_wagered || 0) + (leg.totalWageredDelta || 0),
        total_won: (wallet.total_won || 0) + (leg.totalWonDelta || 0),
        total_deposited: (wallet.total_deposited || 0) + (leg.totalDepositedDelta || 0),
        total_withdrawn: (wallet.total_withdrawn || 0) + (leg.totalWithdrawnDelta || 0),
      });
      entries.push({
        user_id: leg.userId, match_id: matchId || '', wallet_transaction_id: leg.walletTransactionId || walletTransactionId || '',
        ledger_account: 'user_account', transaction_type: leg.transactionType,
        debit_amount: leg.debit || 0, credit_amount: leg.credit || 0,
        resulting_available_balance: newAvailable, resulting_held_balance: newHeld, resulting_total_balance: newTotal,
        initiating_actor: actor, initiating_actor_id: actorId || '', trigger_event: triggerEvent,
        external_reference_type: externalRefType || 'none', external_reference_id: externalRefId || '',
        ledger_group_id: groupId, correlation_id: correlationId, game_id: gameId || '',
        currency: 'USD', schema_version: 1,
      });
    } else {
      const accounts = await base44.asServiceRole.entities.SystemLedgerAccount.filter({ account_name: leg.ledgerAccount });
      let acct = accounts[0];
      if (!acct) acct = await base44.asServiceRole.entities.SystemLedgerAccount.create({ account_name: leg.ledgerAccount, balance: 0 });
      const newBalance = (acct.balance || 0) - (leg.debit || 0) + (leg.credit || 0);
      if (['contest_clearing', 'suspense', 'platform_revenue'].includes(leg.ledgerAccount) && newBalance < -0.001) {
        throw new Error(`Ledger posting would overdraw protected account: ${leg.ledgerAccount}`);
      }
      await base44.asServiceRole.entities.SystemLedgerAccount.update(acct.id, { balance: newBalance });
      entries.push({
        match_id: matchId || '', wallet_transaction_id: leg.walletTransactionId || walletTransactionId || '',
        ledger_account: leg.ledgerAccount, transaction_type: leg.transactionType,
        debit_amount: leg.debit || 0, credit_amount: leg.credit || 0,
        resulting_total_balance: newBalance,
        initiating_actor: actor, initiating_actor_id: actorId || '', trigger_event: triggerEvent,
        external_reference_type: externalRefType || 'none', external_reference_id: externalRefId || '',
        ledger_group_id: groupId, correlation_id: correlationId, game_id: gameId || '',
        currency: 'USD', schema_version: 1,
      });
    }
  }
  const createdEntries = await base44.asServiceRole.entities.LedgerEntry.bulkCreate(entries);

  // Normalize the user-facing transaction(s) and emit a provider-neutral
  // outbox record only after the balanced ledger posting has succeeded.
  // Integration metadata is deliberately non-authoritative and cannot roll
  // back money.
  //
  // A single balanced posting can touch more than one player's
  // WalletTransaction — e.g. a decisive Match settlement posts the
  // winner's payout and the loser's forfeiture together in one call so they
  // complete atomically (either both land or neither does). Mark every
  // distinct WalletTransaction referenced by these legs as completed, not
  // just the call-level/primary one.
  const directionByType = {
    deposit: 'credit',
    withdrawal: 'debit',
    wager_lock: 'reserve',
    wager_refund: 'release',
    payout: 'credit',
    wager_forfeit: 'release',
    service_fee_charge: 'reserve',
    service_fee_refund: 'release',
  };
  const requiresExternalRail = ['deposit', 'withdrawal', 'account_closure_disbursement'].includes(triggerEvent);
  const walletTransactionIds = [...new Set(
    legs.map((leg) => leg.walletTransactionId).concat([walletTransactionId]).filter(Boolean)
  )];
  let walletTransaction = null;
  for (const id of walletTransactionIds) {
    try {
      const current = await base44.asServiceRole.entities.WalletTransaction.get(id);
      if (id === walletTransactionId) walletTransaction = current;
      await base44.asServiceRole.entities.WalletTransaction.update(id, {
        status: 'completed',
        currency: 'USD',
        direction: directionByType[current.type] || 'internal',
        correlation_id: correlationId,
        ledger_group_id: groupId,
        source_event: triggerEvent,
        initiating_actor: actor,
        initiating_actor_id: actorId || '',
        processed_at: new Date().toISOString(),
        integration_status: requiresExternalRail ? 'unrouted' : 'internal_complete',
        idempotency_key: current.idempotency_key || `ledger:${groupId}`,
        schema_version: 1,
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'wallet_transaction_trace_update_failed',
        wallet_transaction_id: id,
        ledger_group_id: groupId,
        error: error?.message || 'unknown_error',
      }));
    }
  }

  const affectedUserIds = [...new Set(legs.map((leg) => leg.userId).filter(Boolean))];
  await recordIntegrationEvent(base44, {
    eventType: `financial.${triggerEvent}`,
    aggregateType: walletTransactionId ? 'wallet_transaction' : 'ledger_group',
    aggregateId: walletTransactionId || groupId,
    correlationId,
    idempotencyKey: `ledger:${groupId}`,
    actorType: actor,
    actorId: actorId || '',
    userId: walletTransaction?.user_id || affectedUserIds[0] || '',
    counterpartyUserId: affectedUserIds.find((id) => id !== (walletTransaction?.user_id || affectedUserIds[0])) || '',
    matchId: matchId || '',
    gameId: gameId || '',
    walletTransactionId: walletTransactionId || '',
    ledgerGroupId: groupId,
    // This event is emitted only after the balanced ledger posting succeeds.
    // The fetched transaction may still contain its pre-update `pending` value,
    // so never copy that stale snapshot into the integration outbox.
    status: 'completed',
    amount: walletTransaction?.amount,
    currency: 'USD',
    result: walletTransaction?.type || triggerEvent,
    eventData: {
      ledger_entry_ids: (createdEntries || []).map((entry) => entry.id),
      transaction_type: walletTransaction?.type || '',
      external_reference_type: externalRefType || 'none',
      external_reference_id: externalRefId || '',
      affected_user_ids: affectedUserIds,
    },
  });

  return createdEntries || entries;
}