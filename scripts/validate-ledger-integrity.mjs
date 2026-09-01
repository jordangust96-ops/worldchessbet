import assert from 'node:assert/strict';
import { auditLedgerSnapshot } from '../base44/shared/ledgerIntegrityPure.js';

const base = {
  entries: [
    { id: 'e1', ledger_group_id: 'g1', user_id: 'u1', ledger_account: 'user_account', debit_amount: 0, credit_amount: 100, resulting_available_balance: 100, resulting_held_balance: 0, resulting_total_balance: 100, created_date: '2026-01-01T00:00:00Z' },
    { id: 'e2', ledger_group_id: 'g1', ledger_account: 'settlement', debit_amount: 100, credit_amount: 0, resulting_total_balance: -100, created_date: '2026-01-01T00:00:00Z' },
  ],
  wallets: [{ user_id: 'u1', available_balance: 100, held_balance: 0, total_balance: 100 }],
  accounts: [{ account_name: 'settlement', balance: -100 }, { account_name: 'platform_revenue', balance: 0 }, { account_name: 'suspense', balance: 0 }],
  transactions: [{ id: 't1', status: 'completed', ledger_group_id: 'g1', idempotency_key: 'deposit:1' }],
  seamlessOperations: [],
};
const clean = auditLedgerSnapshot(base);
assert.equal(clean.unbalanced_groups.length, 0);
assert.equal(clean.projection_mismatches.length, 0);
assert.equal(clean.duplicate_operation_ids.length, 0);
assert.equal(clean.missing_source_transactions.length, 0);

const unbalanced = auditLedgerSnapshot({ ...base, entries: base.entries.slice(0, 1) });
assert.equal(unbalanced.unbalanced_groups.length, 1, 'unbalanced group is detected');

const drift = auditLedgerSnapshot({ ...base, wallets: [{ ...base.wallets[0], available_balance: 87, total_balance: 87 }] });
assert.equal(drift.projection_mismatches.length, 1, 'stored wallet projection drift is detected');

const duplicate = auditLedgerSnapshot({ ...base, transactions: [...base.transactions, { id: 't2', status: 'completed', ledger_group_id: 'g1', idempotency_key: 'deposit:1' }] });
assert.equal(duplicate.duplicate_operation_ids.length, 1, 'duplicate completed logical operation is detected');

const missing = auditLedgerSnapshot({ ...base, transactions: [{ id: 't3', status: 'completed', ledger_group_id: 'missing', idempotency_key: 'missing:1' }] });
assert.deepEqual(missing.missing_source_transactions, ['t3'], 'completed transaction without ledger evidence is detected');

const seamless = auditLedgerSnapshot({ ...base, seamlessOperations: [{ id: 's1', operation_type: 'withdrawal', status: 'uncertain', wallet_transaction_id: 't1' }] });
assert.equal(seamless.incomplete_seamless_operations.length, 1, 'incomplete Seamless operation is reported');

console.log('Ledger integrity validation passed.');