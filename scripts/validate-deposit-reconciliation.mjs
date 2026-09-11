import assert from 'node:assert/strict';
import { loadBackend } from './helpers/load-backend.mjs';
import * as pure from '../base44/shared/depositReconciliationPure.js';
import * as ach from '../base44/shared/seamlessAchPure.js';
import { depositQuote } from '../base44/shared/depositPricing.js';

const clone = value => structuredClone(value);
async function harness() {
  const db = Object.fromEntries(['WalletTransaction','Wallet','LedgerEntry','LedgerJournalBatch','SystemLedgerAccount',
    'OperationsFinding','DepositSettlementEvidence','IntegrationReference','User'].map(name => [name, []]));
  let serial = 0, caller = { id: 'admin', role: 'admin' }, fail = null, occupied = false;
  const provider = { success: true, check: { check_id: 'provider-1', amount: 101.01, fee: 0, status: 'processed', label: 'chessbet-deposit-tx-1' } };
  const match = (row, query) => Object.entries(query).every(([key,value]) => {
    if (value && typeof value === 'object') {
      if ('$in' in value) return value.$in.includes(row[key]);
      if ('$exists' in value) return (row[key] !== undefined) === value.$exists;
    }
    return row[key] === value;
  });
  const entities = Object.fromEntries(Object.keys(db).map(name => [name, {
    filter: async (query = {}, sort, limit = 5000, skip = 0) => clone(db[name].filter(row => match(row, query)).slice(skip, skip + limit)),
    get: async id => clone(db[name].find(row => row.id === id)),
    create: async fields => {
      const row = { id: name + '-' + ++serial, created_date: new Date().toISOString(), ...clone(fields) };
      db[name].push(row); return clone(row);
    },
    update: async (id, fields) => {
      if (fail?.(name, fields)) { fail = null; throw new Error('injected_write_failure'); }
      const row = db[name].find(row => row.id === id);
      if (!row) throw new Error('missing_mock_row:' + name + ':' + id);
      Object.assign(row, clone(fields)); return clone(row);
    },
    bulkCreate: async fields => Promise.all(fields.map(row => entities[name].create(row))),
  }]));
  const base44 = { auth: { me: async () => caller }, asServiceRole: { entities } };
  const events = new Map();
  const atomic = {
    acquireLedgerLock: async () => true, releaseLedgerLock: async () => {},
    claimWebhookEvent: async key => {
      if (occupied) return { claim: 'transaction_busy' };
      if (events.get(key) === 'completed') return { claim: 'completed' };
      occupied = true; return { claim: 'owned' };
    },
    finishWebhookEvent: async (key, ref, owner, state) => { events.set(key, state); occupied = false; },
  };
  const eventModule = { recordIntegrationEvent: async () => {} };
  const { exports: ledger } = await loadBackend('base44/shared/ledger.ts', {
    './integrationEvents.ts': eventModule, './seamlessAtomicStore.ts': atomic,
  });
  const providerApi = { ...ach, seamlessRequest: async () => clone(provider) };
  const { exports: reconciliation } = await loadBackend('base44/shared/depositReconciliation.ts', {
    './seamlessAch.ts': providerApi, './ledger.ts': ledger, './depositReconciliationPure.js': pure,
  });
  const { exports: transitions } = await loadBackend('base44/shared/seamlessLedgerTransitions.ts', {
    './ledger.ts': ledger, './depositReconciliation.ts': reconciliation,
    './depositReconciliationPure.js': pure, './seamlessAtomicStore.ts': atomic,
  });
  const { handler } = await loadBackend('base44/functions/reconcileDepositSettlement/entry.ts', {
    'npm:@base44/sdk@0.8.48': { createClientFromRequest: () => base44 },
    '../../shared/seamlessAch.ts': providerApi,
    '../../shared/seamlessAtomicStore.ts': atomic,
    '../../shared/depositReconciliation.ts': reconciliation,
    '../../shared/depositReconciliationPure.js': pure,
    '../../shared/seamlessLedgerTransitions.ts': transitions,
    '../../shared/ledger.ts': ledger,
  });
  const quote = depositQuote(100);
  db.WalletTransaction.push({ id:'tx-1', user_id:'player', type:'deposit', amount:100,
    deposit_pricing_version:quote.version, deposit_processing_fee:quote.fee, deposit_bank_debit:quote.bankDebit,
    deposit_fee_accepted_at:'2026-01-01T00:00:00Z', created_date:'2026-01-01T00:00:00Z',
    status:'pending', integration_status:'submitted', launch_epoch:2 });
  db.IntegrationReference.push({ id:'ref-1', wallet_transaction_id:'tx-1',
    provider_key:ach.SEAMLESS_PROVIDER_KEY, external_reference_id:'provider-1' });
  db.Wallet.push({ id:'wallet', user_id:'player', available_balance:0, held_balance:0, total_balance:0 });
  db.User.push({ id:'player', ach_return_balance_due:0 });
  const tx = () => clone(db.WalletTransaction[0]);
  const settlement = { action:'recordSettlement', transactionId:'tx-1', bankDebit:'101.01',
    processingFee:'1.01', netReceived:'100.00', source:'seamless_statement',
    evidenceReference:'Statement 2026-01-08 line 7 provider-1', confirmedAgainstSeamless:true };
  const send = data => handler(new Request('https://example.test', { method:'POST', body:JSON.stringify(data) }));
  return { db, base44, provider, transitions, ledger, tx, settlement, send,
    setCaller:value => { caller = value; }, setFailure:value => { fail = value; },
    setOccupied:value => { occupied = value; } };
}
function balanced(db) {
  for (const batch of db.LedgerJournalBatch) assert.equal(batch.total_debit, batch.total_credit);
  const ids = db.LedgerEntry.map(row => row.ledger_group_id + ':' + row.ledger_leg_index);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ledger legs');
}

for (const invalid of [null, undefined, '', ' ', true, -1, '1e2', '1.001', Infinity]) {
  assert.throws(() => pure.moneyCents(invalid));
}
const h = await harness();
h.setCaller({id:'player',role:'user'});
assert.equal((await h.send(h.settlement)).status,403);
h.setCaller({id:'admin',role:'admin'});
assert.equal((await h.send({...h.settlement,confirmedAgainstSeamless:false})).status,400);
await assert.rejects(h.transitions.postSeamlessSettlement(h.base44,h.tx(),100,'provider-1','test'),/deposit_reconciliation_required/);
assert.equal(h.db.LedgerEntry.length,0,'Processed and fee:0 cannot prove actual net settlement');
assert.equal(h.db.Wallet[0].available_balance,0);
h.provider.check.amount = 100;
assert.equal((await h.send(h.settlement)).status,409);
h.provider.check.amount = 101.01;
assert.equal((await h.send({...h.settlement,netReceived:'99.99'})).status,409);
assert.equal(h.db.LedgerEntry.length,0,'a one-cent mismatch cannot credit funds');
assert.equal((await h.send(h.settlement)).status,200);
assert.equal(h.db.Wallet[0].held_balance,100);
assert.equal(h.db.Wallet[0].available_balance,0);
assert.equal(h.db.Wallet[0].total_deposited,100);
assert.equal(h.db.SystemLedgerAccount.find(row => row.account_name === 'settlement').balance,-100);
assert.equal(h.db.SystemLedgerAccount.find(row => row.account_name === 'processor_fee_clearing').balance,0);
assert.ok(!h.db.LedgerEntry.some(row => row.ledger_account === 'platform_revenue'));
const count = h.db.LedgerEntry.length;
assert.equal((await h.send(h.settlement)).status,200);
assert.equal(h.db.LedgerEntry.length,count);
h.db.WalletTransaction[0].deposit_release_at = '2999-01-01T00:00:00Z';
assert.equal(await h.transitions.releaseDepositAvailability(h.base44,h.tx()),false);
h.db.WalletTransaction[0].deposit_release_at = '2026-01-01T00:00:00Z';
h.provider.check.status = 'processing';
await assert.rejects(h.transitions.releaseDepositAvailability(h.base44,h.tx()),/deposit_reconciliation_required/);
assert.equal(h.db.Wallet[0].available_balance,0);
h.provider.check.status = 'processed';
h.setOccupied(true);
await assert.rejects(h.transitions.releaseDepositAvailability(h.base44,h.tx()),/deposit_transition_in_progress/);
h.setOccupied(false);
assert.equal(await h.transitions.releaseDepositAvailability(h.base44,h.tx()),true);
assert.equal(h.db.Wallet[0].available_balance,100);
assert.equal(h.db.Wallet[0].held_balance,0);
assert.equal(await h.transitions.releaseDepositAvailability(h.base44,h.tx()),false);
h.provider.check.status = 'failed';
await h.transitions.reverseSeamlessSettlement(h.base44,h.tx(),100,'provider-1','test_return');
assert.equal(h.db.Wallet[0].available_balance,0);
assert.equal(h.tx().status,'reversed');
assert.equal(h.tx().deposit_return_reconciliation_status,'awaiting_evidence');
const returns = { action:'recordReturn', transactionId:'tx-1', processingFeeRetained:'1.01',
  returnFee:'15.00', additionalCashDebit:'16.01', source:'seamless_statement',
  evidenceReference:'Statement 2026-01-09 return provider-1', confirmedAgainstSeamless:true };
assert.equal((await h.send({...returns,additionalCashDebit:'16.00'})).status,409);
assert.equal((await h.send(returns)).status,200);
assert.equal(h.tx().status,'reversed','fee entries cannot resurrect a returned deposit');
assert.equal(h.db.Wallet[0].total_deposited,0);
assert.equal(h.db.SystemLedgerAccount.find(row => row.account_name === 'processor_fee_expense').balance,-1.01);
assert.equal(h.db.SystemLedgerAccount.find(row => row.account_name === 'ach_return_fee_expense').balance,-15);
assert.equal(h.db.SystemLedgerAccount.find(row => row.account_name === 'settlement').balance,16.01);
const returnedCount = h.db.LedgerEntry.length;
assert.equal((await h.send(returns)).status,200);
assert.equal(h.db.LedgerEntry.length,returnedCount);
balanced(h.db);

// A crash after journal/balance writes must recover without another credit,
// release, return, or fee posting.
for (const phase of ['settlement','release','return']) {
  const s = await harness();
  if (phase === 'settlement') s.setFailure((name,fields) => name === 'WalletTransaction' && fields.deposit_hold_status === 'held');
  const first = await s.send(s.settlement);
  if (phase === 'settlement') {
    assert.equal(first.status,409);
    assert.equal(s.tx().status,'pending');
    assert.equal((await s.send(s.settlement)).status,200);
  } else assert.equal(first.status,200);
  if (phase === 'release') s.setFailure((name,fields) => name === 'WalletTransaction' && fields.deposit_hold_status === 'released');
  if (phase === 'release') await assert.rejects(s.transitions.releaseDepositAvailability(s.base44,s.tx()));
  await s.transitions.releaseDepositAvailability(s.base44,s.tx());
  assert.equal(s.db.Wallet[0].available_balance,100);
  if (phase === 'return') {
    s.setFailure((name,fields) => name === 'WalletTransaction' && fields.status === 'reversed');
    await assert.rejects(s.transitions.reverseSeamlessSettlement(s.base44,s.tx(),100,'provider-1','test_return'));
    await s.transitions.reverseSeamlessSettlement(s.base44,s.tx(),100,'provider-1','test_return');
    assert.equal(s.db.Wallet[0].available_balance,0);
    assert.equal(s.db.User[0].ach_return_balance_due,0);
  }
  balanced(s.db);
}
// Return after funds were spent: replay must preserve the original debt.
const d = await harness();
assert.equal((await d.send(d.settlement)).status,200);
await d.transitions.releaseDepositAvailability(d.base44,d.tx());
await d.ledger.postLedgerLegs(d.base44, {groupId:'spend',actor:'system',triggerEvent:'test_spend',updateTransactions:false,
  legs:[{ledgerAccount:'user_account',userId:'player',debit:100,credit:0,transactionType:'withdrawal'},
    {ledgerAccount:'settlement',debit:0,credit:100,transactionType:'withdrawal'}]});
d.setFailure((name,fields) => name === 'WalletTransaction' && fields.status === 'reversed');
await assert.rejects(d.transitions.reverseSeamlessSettlement(d.base44,d.tx(),100,'provider-1','test_return'));
assert.equal(d.db.User[0].ach_return_balance_due,100);
await d.transitions.reverseSeamlessSettlement(d.base44,d.tx(),100,'provider-1','test_return');
assert.equal(d.db.User[0].ach_return_balance_due,100);
balanced(d.db);

// Canonical postings, not a stale pending flag, determine how a later return
// is handled after a crash between wallet materialization and status update.
const interrupted = await harness();
interrupted.setFailure((name,fields) => name === 'WalletTransaction' && fields.deposit_hold_status === 'held');
assert.equal((await interrupted.send(interrupted.settlement)).status,409);
interrupted.provider.check.status = 'failed';
const recovered = await interrupted.transitions.recoverFeeDepositState(interrupted.base44,interrupted.tx());
assert.equal(ach.applyWebhookEvent(recovered,{status:'failed'}).action,'reverse');
await interrupted.transitions.reverseSeamlessSettlement(interrupted.base44,recovered,100,'provider-1','test_return');
assert.equal(interrupted.db.Wallet[0].held_balance,0);
assert.equal(interrupted.db.Wallet[0].available_balance,0);
balanced(interrupted.db);

const identity = await harness();
for (const patch of [{check_id:'wrong'}, {currency:'EUR'}, {label:'chessbet-deposit-other'}, {amount:null}]) {
  const original = clone(identity.provider.check);
  Object.assign(identity.provider.check,patch);
  assert.equal((await identity.send(identity.settlement)).status,409);
  assert.equal(identity.db.LedgerEntry.length,0);
  identity.provider.check = original;
}
identity.db.WalletTransaction[0].deposit_processing_fee = 0.5;
assert.equal((await identity.send(identity.settlement)).status,409);
assert.equal(identity.db.LedgerEntry.length,0);
const legacy = await harness();
for (const key of ['deposit_pricing_version','deposit_bank_debit','deposit_processing_fee','deposit_fee_accepted_at']) delete legacy.db.WalletTransaction[0][key];
assert.equal((await legacy.send(legacy.settlement)).status,409,'legacy deposits excluded from new review');

console.log('PASS: real handlers and ledger; amount mismatch, missing evidence, admin authorization, balanced gross/fee/net, clearing, duplicate/racing requests, return fees, and interrupted-write recovery.');
