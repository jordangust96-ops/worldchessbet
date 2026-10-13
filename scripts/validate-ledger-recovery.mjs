import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const withoutImports = (source) => source.replace(/^import .*;\n/gm, '');
const paginationSource = read('base44/shared/ledgerPagination.ts').replace('export async function', 'async function');
const allLedgerRows = new Function(paginationSource + '\nreturn allLedgerRows;')();
const ledgerSource = withoutImports(read('base44/shared/ledger.ts').split('// Shared Internal Ledger posting helper.')[0])
  .replace('export async function', 'async function');
const rebuildLedgerBalances = new Function('allLedgerRows', ledgerSource + '\nreturn rebuildLedgerBalances;')(allLedgerRows);
const recoverySource = withoutImports(read('base44/functions/reconcile-ledger-materializations/entry.ts'));
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

function fixture(groups = 1) {
  const db = { LedgerJournalBatch: [], LedgerEntry: [], Wallet: [{
    id: 'wallet', user_id: 'alice', balance: groups * 10, available_balance: groups * 10,
    held_balance: 0, total_balance: groups * 10, total_wagered: 0, total_won: 0,
    total_deposited: groups * 10, total_withdrawn: 0,
  }], SystemLedgerAccount: [{ id: 'settlement', account_name: 'settlement', balance: -groups * 10 }] };
  for (let index = 0; index < groups; index++) {
    const group = 'deposit-' + index;
    const legs = [
      { ledger_group_id: group, ledger_leg_index: 0, launch_epoch: 2, ledger_account: 'settlement',
        debit_amount: 10, credit_amount: 0 },
      { ledger_group_id: group, ledger_leg_index: 1, launch_epoch: 2, ledger_account: 'user_account',
        user_id: 'alice', debit_amount: 0, credit_amount: 10, available_delta: 10, held_delta: 0,
        total_deposited_delta: 10 },
    ];
    db.LedgerJournalBatch.push({ ledger_group_id: group, launch_epoch: 2, leg_count: 2,
      total_debit: 10, total_credit: 10, legs_json: JSON.stringify(legs) });
    db.LedgerEntry.push(...structuredClone(legs));
  }
  return db;
}

async function run(db, options = {}) {
  const stats = { reads: 0, writes: 0, bulkCreates: 0, released: 0, refreshed: 0, logs: [] };
  const entities = new Proxy({}, { get: (_, name) => ({
    filter: async (query = {}, sort, limit = 500, skip = 0) => {
      stats.reads++;
      if (options.failAtRead === stats.reads) throw new Error('Rate limit exceeded');
      return structuredClone(db[name].filter(row => Object.entries(query).every(([k, v]) => row[k] === v)).slice(skip, skip + limit));
    },
    create: async row => {
      stats.writes++;
      const saved = { ...structuredClone(row), id: name + db[name].length };
      db[name].push(saved);
      return structuredClone(saved);
    },
    update: async (id, patch) => {
      stats.writes++;
      Object.assign(db[name].find(row => row.id === id), structuredClone(patch));
    },
    bulkCreate: async rows => {
      stats.bulkCreates++;
      stats.writes++;
      if (!options.dropBulkWrite) db[name].push(...structuredClone(rows));
    },
  }) });
  let handler;
  const base44 = { auth: { me: async () => options.unauthorized ? null : { role: 'admin' } }, asServiceRole: { entities } };
  new Function('Deno', 'createClientFromRequest', 'allLedgerRows', 'rebuildLedgerBalances',
    'acquireLedgerLock', 'releaseLedgerLock', 'refreshLedgerLock', 'console', recoverySource)(
    { serve: fn => { handler = fn; } }, () => base44, allLedgerRows, rebuildLedgerBalances,
    async () => !options.busy,
    async () => { stats.released++; },
    async () => { stats.refreshed++; return stats.refreshed !== options.loseAtRefresh; },
    { info: message => stats.logs.push(JSON.parse(message)), error: message => stats.logs.push(JSON.parse(message)) },
  );
  const response = await handler(new Request('https://test.invalid/recovery', { method: 'POST' }));
  return { status: response.status, body: await response.json(), stats };
}

// Healthy histories scale with pages, not one request per journal batch.
let db = fixture(300);
let result = await run(db);
eq(result.status, 200);
eq(result.body.atomic_batches_checked, 300);
eq(result.body.ledger_groups_checked, 300);
eq(result.stats.reads, 7);
eq(result.stats.writes, 0);
eq(result.body.wallets_updated, 0);
eq(result.stats.released, 1);

// Repair only missing immutable projections; a second run must be a no-op.
db = fixture();
db.LedgerEntry.pop();
db.Wallet[0].balance = db.Wallet[0].available_balance = db.Wallet[0].total_balance = 0;
db.Wallet[0].total_deposited = 0;
result = await run(db);
eq(result.status, 200);
eq(result.body.missing_legs_materialized, 1);
eq(result.stats.bulkCreates, 1);
eq(db.Wallet[0].available_balance, 10);
eq(result.body.wallets_updated, 1);
result = await run(db);
eq(result.status, 200);
eq(result.stats.writes, 0);
eq(db.LedgerEntry.length, 2);

// Missing wallets/accounts can be recovered; correct projections stay untouched.
db = fixture();
db.Wallet = [];
db.SystemLedgerAccount = [];
result = await run(db);
eq(result.status, 200);
eq(db.Wallet[0].available_balance, 10);
eq(db.SystemLedgerAccount[0].balance, -10);
eq((await run(db)).stats.writes, 0);

// Incomplete writes and invalid journals never produce a successful sweep.
db = fixture(); db.LedgerEntry.pop();
result = await run(db, { dropBulkWrite: true });
eq(result.status, 500);
eq(result.stats.logs.at(-1).error, 'ledger_projection_incomplete:deposit-0');
eq(result.body.stage, 'validate_and_repair_entries');
db = fixture(); db.LedgerEntry.push(structuredClone(db.LedgerEntry[0]));
result = await run(db);
eq(result.status, 500); eq(result.stats.writes, 0);
db = fixture(); db.LedgerEntry[0].ledger_leg_index = 99;
result = await run(db);
eq(result.status, 500); eq(result.stats.writes, 0);
db = fixture(); db.LedgerJournalBatch.push(structuredClone(db.LedgerJournalBatch[0]));
result = await run(db);
eq(result.status, 500); eq(result.stats.writes, 0);
db = fixture(); db.LedgerJournalBatch[0].total_debit = 11;
result = await run(db);
eq(result.status, 500); eq(result.stats.writes, 0);
db = fixture(); db.LedgerEntry[0].debit_amount = 11;
result = await run(db);
eq(result.status, 500); eq(result.stats.writes, 0);

// A failed page is not an empty ledger, and a lost lease is not reacquired.
result = await run(fixture(), { failAtRead: 2 });
eq(result.status, 500); eq(result.body.reason, 'rate_limited'); eq(result.stats.writes, 0);
eq(result.stats.released, 1);
db = fixture(); db.LedgerEntry.pop();
result = await run(db, { loseAtRefresh: 1 });
eq(result.status, 500); eq(result.body.reason, 'ledger_lease_lost'); eq(result.stats.writes, 0);
db = fixture(); db.Wallet[0].balance = 0;
result = await run(db, { loseAtRefresh: 2 });
eq(result.status, 500); eq(result.body.reason, 'ledger_lease_lost'); eq(result.stats.writes, 0);
result = await run(fixture(), { busy: true });
eq(result.status, 202); eq(result.stats.reads, 0); eq(result.stats.released, 0);
result = await run(fixture(), { unauthorized: true });
eq(result.status, 401); eq(result.stats.reads, 0); eq(result.stats.released, 0);
console.log('Ledger recovery: ' + checks + ' assertions passed.');
