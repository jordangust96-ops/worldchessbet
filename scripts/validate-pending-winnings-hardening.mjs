import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBackend } from './helpers/load-backend.mjs';

const pagination = (await loadBackend('base44/shared/ledgerPagination.ts')).exports;
let locked = false;
let onLock = null;
const ledger = (await loadBackend('base44/shared/ledger.ts', {
  './ledgerPagination.ts': pagination,
  './integrationEvents.ts': { recordIntegrationEvent: async () => {} },
  './seamlessAtomicStore.ts': {
    acquireLedgerLock: async () => { if (locked) return false; locked = true; if (onLock) { const f=onLock; onLock=null; f(); } return true; },
    releaseLedgerLock: async () => { locked = false; },
  },
})).exports;

function entity(initial = []) {
  const rows = structuredClone(initial);
  let failUpdate = false;
  return {
    rows, failNextUpdate() { failUpdate = true; },
    async get(id) { return structuredClone(rows.find(r => r.id === id)); },
    async filter(query, sort = 'created_date', limit = 500, skip = 0) {
      const matches = rows.filter(r => Object.entries(query).every(([k,v]) =>
        v && typeof v === 'object' ? ('$lte' in v && r[k] <= v.$lte) : r[k] === v));
      const key = sort.replace(/^-/, '');
      matches.sort((a,b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (sort.startsWith('-') ? -1 : 1));
      return structuredClone(matches.slice(skip, skip + limit));
    },
    async create(value) { const r = { id: 'row-' + rows.length, created_date: new Date().toISOString(), ...value }; rows.push(r); return structuredClone(r); },
    async bulkCreate(values) { return Promise.all(values.map(v => this.create(v))); },
    async update(id, patch) { if (failUpdate) { failUpdate = false; throw Error('simulated write interruption'); } Object.assign(rows.find(r => r.id === id), patch); },
  };
}
const now = Date.now();
const due = (id, release = now - 60000) => ({
  id, type: 'payout', status: 'completed', payout_hold_status: 'held', amount: 10,
  user_id: id, match_id: id, payout_release_at: new Date(release).toISOString(),
  processed_at: new Date(now - 25 * 3600000).toISOString(),
});
function database(payouts) {
  const entities = {
    WalletTransaction: entity(payouts),
    Wallet: entity(payouts.map(p => ({ id: p.id, user_id: p.user_id, available_balance: 0, held_balance: 30 }))),
    SystemLedgerAccount: entity(),
    LedgerEntry: entity(payouts.map(p => ({ id: 'seed-' + p.id, user_id: p.user_id, launch_epoch: 2,
      available_delta: 0, held_delta: 30, created_date: '2020-01-01', ledger_account: 'user_account' }))),
    LedgerJournalBatch: entity(),
    DisputeCase: entity(),
    IntegrityFlag: entity(),
    ContestRecord: entity(payouts.map(p => ({ id: p.id, match_id: p.match_id,
      settlement_timestamp: new Date(now - 25 * 3600000).toISOString() }))),
  };
  return { asServiceRole: { entities } };
}
async function sweep(db) {
  const { handler } = await loadBackend('base44/functions/releasePendingWinnings/entry.ts', {
    'npm:@base44/sdk@0.8.38': { createClientFromRequest: () => db },
    '../../shared/ledger.ts': ledger,
    '../../shared/ledgerPagination.ts': pagination,
    '../../shared/reportWindow.ts': { REPORT_WINDOW_MS: 24 * 3600000 },
  });
  return (await handler({})).json();
}

// Complete due pagination: 501 eligible payouts behind 200 future payouts.
{
  const payouts = [...Array.from({length:501},(_,i)=>due('due'+i)), ...Array.from({length:200},(_,i)=>due('future'+i,now+3600000))];
  const db=database(payouts);
  const result=await sweep(db);
  assert.equal(result.releasedCount,501);
  assert.equal(db.asServiceRole.entities.WalletTransaction.rows.filter(r=>r.payout_hold_status==='held').length,200);
}
// Exact available/held transfer, unchanged total and settlement metadata.
{
  const db=database([due('winner')]); const e=db.asServiceRole.entities;
  const original=e.WalletTransaction.rows[0].processed_at;
  assert.equal((await sweep(db)).releasedCount,1);
  assert.equal(e.Wallet.rows[0].available_balance,10);
  assert.equal(e.Wallet.rows[0].held_balance,20);
  assert.equal(e.Wallet.rows[0].total_balance,30);
  assert.equal(e.WalletTransaction.rows[0].processed_at,original);
  assert.equal((await sweep(db)).releasedCount,0);
}
// Deadline uses the later contest-record timestamp; missing evidence fails closed.
for (const stamp of [new Date(now-3600000).toISOString(), 'invalid']) {
  const db=database([due('deadline')]);
  db.asServiceRole.entities.ContestRecord.rows[0].settlement_timestamp=stamp;
  assert.equal((await sweep(db)).releasedCount,0);
}
// Fresh flags/cases are checked after obtaining the financial lock.
for (const kind of ['case','flag']) {
  const db=database([due('blocked')]); const e=db.asServiceRole.entities;
  onLock=()=>{ if(kind==='case') e.DisputeCase.rows.push({match_id:'blocked',status:'open'});
    else e.IntegrityFlag.rows.push({match_id:'blocked',user_id:'blocked',flag_type:'engine_assistance_suspected',severity:'medium',status:'open'}); };
  assert.equal((await sweep(db)).releasedCount,0);
}
// A failed status write retries the SAME journal group without releasing unrelated held funds.
{
  const db=database([due('retry')]); const e=db.asServiceRole.entities;
  e.WalletTransaction.failNextUpdate();
  assert.equal((await sweep(db)).failedIds.length,1);
  assert.equal(e.Wallet.rows[0].available_balance,10);
  assert.equal((await sweep(db)).releasedCount,1);
  assert.equal(e.Wallet.rows[0].available_balance,10);
  assert.equal(e.LedgerJournalBatch.rows.length,1);
}
// Overlapping sweeps and a later retry cannot create a second credit.
{
  const db=database([due('race')]); const e=db.asServiceRole.entities;
  await Promise.all([sweep(db),sweep(db)]);
  await sweep(db);
  assert.equal(e.Wallet.rows[0].available_balance,10);
  assert.equal(e.LedgerJournalBatch.rows.length,1);
}
// Full user AND system history beyond the former 5,000-row ceiling.
{
  const db=database([]); const e=db.asServiceRole.entities;
  e.Wallet.rows.push({id:'long',user_id:'long'});
  for(let i=0;i<5001;i++) {
    e.LedgerEntry.rows.push({id:'u'+i,user_id:'long',launch_epoch:2,created_date:String(i).padStart(6,'0'),available_delta:i===5000?10:0});
    e.LedgerEntry.rows.push({id:'s'+i,ledger_account:'platform_revenue',launch_epoch:2,created_date:String(i).padStart(6,'0'),credit_amount:i===5000?10:0});
  }
  await ledger.rebuildLedgerBalances(db,{userIds:['long'],systemAccounts:['platform_revenue']});
  assert.equal(e.Wallet.rows[0].available_balance,10);
  assert.equal(e.SystemLedgerAccount.rows[0].balance,10);
}
const [flag,dispute,wallet] = await Promise.all([
  'base44/functions/manageIntegrityFlag/entry.ts','base44/functions/manageDisputeCase/entry.ts','src/pages/WalletPage.jsx',
].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')));
assert.doesNotMatch(flag,/applyBalanceHold/,'flag clearing cannot post a payout release');
assert.doesNotMatch(dispute,/triggerEvent: 'pending_winnings_release'/,'case resolution cannot post a payout release');
assert.match(dispute,/if \(adoptedPayout\)/,'generic hold release cannot consume an adopted payout');
assert.match(wallet,/setInterval\(refreshBalance, 15000\)/);
console.log('Pending winnings hardening: pagination, deadlines, review gates, retry/concurrency, complete ledger history, and refresh passed.');
