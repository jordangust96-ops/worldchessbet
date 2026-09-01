// Pure, side-effect-free ledger audit. It detects evidence problems but never
// changes money. Base44's admin function supplies the entity snapshots.
const round = (value) => Math.round(Number(value || 0) * 100) / 100;
const sameMoney = (a, b) => Math.abs(round(a) - round(b)) < 0.01;

export function auditLedgerSnapshot({ entries = [], wallets = [], accounts = [], transactions = [], seamlessOperations = [] }) {
  const groups = new Map();
  const userEntries = new Map();
  for (const entry of entries) {
    const groupId = entry.ledger_group_id || `ungrouped:${entry.id}`;
    const group = groups.get(groupId) || { id: groupId, debits: 0, credits: 0, entries: [] };
    group.debits += Number(entry.debit_amount || 0);
    group.credits += Number(entry.credit_amount || 0);
    group.entries.push(entry);
    groups.set(groupId, group);
    if (entry.user_id) {
      const rows = userEntries.get(entry.user_id) || [];
      rows.push(entry);
      userEntries.set(entry.user_id, rows);
    }
  }

  const unbalanced_groups = [...groups.values()]
    .filter((group) => !sameMoney(group.debits, group.credits))
    .map((group) => ({ ledger_group_id: group.id, debits: round(group.debits), credits: round(group.credits) }));

  const walletByUser = new Map(wallets.map((wallet) => [wallet.user_id, wallet]));
  const missing_wallet_projections = [...userEntries.keys()].filter((userId) => !walletByUser.has(userId));
  const negative_wallets = wallets.filter((wallet) =>
    Number(wallet.available_balance || 0) < -0.001 ||
    Number(wallet.held_balance || 0) < -0.001 ||
    Number(wallet.total_balance || 0) < -0.001
  ).map((wallet) => wallet.user_id);

  const projection_mismatches = [];
  for (const [userId, rows] of userEntries) {
    const wallet = walletByUser.get(userId);
    const last = [...rows].sort((a, b) =>
      String(a.created_date || '').localeCompare(String(b.created_date || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    ).at(-1);
    if (!wallet || !last || last.resulting_available_balance == null || last.resulting_held_balance == null) continue;
    if (
      !sameMoney(wallet.available_balance, last.resulting_available_balance) ||
      !sameMoney(wallet.held_balance, last.resulting_held_balance) ||
      !sameMoney(wallet.total_balance, last.resulting_total_balance)
    ) {
      projection_mismatches.push({
        user_id: userId,
        wallet: { available: round(wallet.available_balance), held: round(wallet.held_balance), total: round(wallet.total_balance) },
        last_ledger: { available: round(last.resulting_available_balance), held: round(last.resulting_held_balance), total: round(last.resulting_total_balance) },
      });
    }
  }

  const accountByName = new Map(accounts.map((account) => [account.account_name, account]));
  const negative_system_accounts = accounts.filter((account) => Number(account.balance || 0) < -0.001)
    .map((account) => account.account_name);
  const missing_source_transactions = transactions
    .filter((transaction) => transaction.status === 'completed' && (!transaction.ledger_group_id || !groups.has(transaction.ledger_group_id)))
    .map((transaction) => transaction.id);

  const duplicate_operation_ids = [];
  const operationBuckets = new Map();
  for (const transaction of transactions) {
    if (!transaction.idempotency_key) continue;
    const bucket = operationBuckets.get(transaction.idempotency_key) || [];
    bucket.push(transaction);
    operationBuckets.set(transaction.idempotency_key, bucket);
  }
  for (const [idempotency_key, rows] of operationBuckets) {
    const completed = rows.filter((row) => row.status === 'completed');
    if (completed.length > 1) duplicate_operation_ids.push({ idempotency_key, transaction_ids: completed.map((row) => row.id) });
  }

  const incomplete_seamless_operations = seamlessOperations
    .filter((operation) => ['reserved', 'submitting', 'uncertain', 'processing', 'retryable'].includes(operation.status))
    .map((operation) => ({ id: operation.id, operation_type: operation.operation_type, wallet_transaction_id: operation.wallet_transaction_id || '', status: operation.status }));

  const settlementEntries = entries.filter((entry) => entry.ledger_account === 'settlement');
  const deposits = settlementEntries.filter((entry) => entry.transaction_type === 'deposit').reduce((sum, entry) => sum + Number(entry.debit_amount || 0), 0);
  const withdrawals = settlementEntries.filter((entry) => entry.transaction_type === 'withdrawal').reduce((sum, entry) => sum + Number(entry.credit_amount || 0), 0);
  const userTotal = wallets.reduce((sum, wallet) => sum + Number(wallet.available_balance || 0) + Number(wallet.held_balance || 0), 0);
  const revenue = Number(accountByName.get('platform_revenue')?.balance || 0);
  const suspense = Number(accountByName.get('suspense')?.balance || 0);
  const aggregate_diff = round(userTotal + revenue + suspense - (deposits - withdrawals));

  return {
    checked: { entries: entries.length, wallets: wallets.length, accounts: accounts.length, transactions: transactions.length },
    unbalanced_groups, missing_wallet_projections, negative_wallets, negative_system_accounts,
    projection_mismatches, duplicate_operation_ids, missing_source_transactions, incomplete_seamless_operations,
    aggregate_diff, balanced: unbalanced_groups.length === 0 && Math.abs(aggregate_diff) < 0.01,
    requires_manual_review: [
      ...unbalanced_groups, ...missing_wallet_projections, ...negative_wallets, ...negative_system_accounts,
      ...projection_mismatches, ...duplicate_operation_ids, ...missing_source_transactions, ...incomplete_seamless_operations,
    ].length > 0 || Math.abs(aggregate_diff) >= 0.01,
  };
}