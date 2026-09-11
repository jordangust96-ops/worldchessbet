import assert from 'node:assert/strict';
import { depositQuote } from '../base44/shared/depositPricing.js';
import { buildDepositBody } from '../base44/shared/seamlessAchPure.js';
import { loadBackend } from './helpers/load-backend.mjs';

for (let cents = 1000; cents <= 109400; cents++) {
  const q = depositQuote(cents / 100);
  assert.ok(q);
  const gross = Math.round(q.bankDebit * 100);
  const fee = Math.round(gross * 0.005 + 50);
  assert.equal(gross - fee, cents, 'exact net wallet credit at every supported cent');
}
assert.equal(depositQuote(10).bankDebit, 10.55);
assert.equal(depositQuote(100).bankDebit, 101.01);
assert.equal(depositQuote(1094).bankDebit, 1100);
for (const invalid of [0, 9.99, 1094.01, 10000, NaN, Infinity, 10.001]) assert.equal(depositQuote(invalid), null);

let operation = null, pending = null, calls = 0, submittedBody;
const user = { id: 'user-test', withdrawal_hold: false };
const bank = { source_id: 'bank-test', is_primary: true };
const api = { auth: { me: async () => user }, asServiceRole: { entities: {
  User: { get: async () => user },
  SeamlessBankAccount: { filter: async () => [bank] },
  SeamlessPaymentProfile: { filter: async () => [{provider_user_id:'provider-test'}] },
  WalletTransaction: {
    create: async data => (pending = {id:'tx-test',created_date:new Date().toISOString(),...data}),
    get: async () => pending,
    update: async (id,data) => Object.assign(pending,data),
  },
  IntegrationReference: { filter: async () => [], create: async data => data },
}}};
const dependencies = {
  'npm:@base44/sdk@0.8.38': { createClientFromRequest: () => api },
  '../../shared/depositPricing.js': { depositQuote },
  '../../shared/seamlessFundingConfig.ts': { seamlessDepositsEnabled: () => true },
  '../../shared/complianceEvidence.ts': { extendComplianceEvidenceRetention: async () => ({authorization_id:'auth-test'}) },
  '../../shared/walletOnboardingLocation.ts': { walletOnboardingLocation: async () => ({allowed:true}) },
  '../../shared/identityEligibility.js': { hasVerifiedIdentity: async () => true },
  '../../shared/legalName.ts': { legalNameFromUser: () => ({fullName:'Test User'}) },
  '../../shared/seamlessAch.ts': {
    seamlessConfig: () => {}, seamlessBaseUrl: () => 'https://example.test',
    buildDepositBody, PATH_ACH_DEBIT:'/ach-debit', SEAMLESS_PROVIDER_KEY:'seamless',
    seamlessRequest: async (method,path,body) => { calls++; submittedBody = body; return {check_id:'check-test'}; },
    userSafeTransferFailureReason: () => 'Declined',
  },
  '../../shared/integrationEvents.ts': { recordIntegrationEvent: async () => {} },
  '../../shared/seamlessAtomicStore.ts': {
    acquireUserWalletLock: async () => true, releaseUserWalletLock: async () => {},
    claimDepositOperation: async (u,k,a) => operation ||= {amount:a,state:'new'},
    saveDepositOperation: async (u,k,data) => (operation=data),
  },
};
const { handler } = await loadBackend('base44/functions/submitSeamlessDeposit/entry.ts', dependencies);
const q = depositQuote(100);
const payload = {amount:100,idempotencyKey:'deposit-test-key-0001',bankSourceId:bank.source_id,depositPricingVersion:q.version,authorizedBankDebit:q.bankDebit};
const send = data => handler(new Request('https://example.test',{method:'POST',body:JSON.stringify(data)}));
assert.equal((await send({...payload,authorizedBankDebit:100})).status,409);
assert.equal(calls,0);
assert.equal((await send({...payload,depositPricingVersion:undefined})).status,409);
assert.equal(calls,0);
assert.equal((await send(payload)).status,200);
assert.equal(Number(submittedBody.amount),101.01);
assert.equal(submittedBody.sender,'provider-test');
assert.equal(pending.amount,100);
assert.equal(pending.deposit_processing_fee,1.01);
assert.equal(pending.deposit_bank_debit,101.01);
assert.equal(pending.status,'pending');
assert.equal((await send(payload)).status,200);
assert.equal(calls,1,'retries must not create a second debit');

let ledgerArgs, releaseArgs;
const { exports: transitions } = await loadBackend('base44/shared/seamlessLedgerTransitions.ts',{
  './ledger.ts': {
    postLedgerLegs: async args => {}, 
    applyBalanceHold: async (b,args) => {releaseArgs=args;},
  },
});
// Capture actual settlement legs with a separate injected ledger.
const { exports: settlement } = await loadBackend('base44/shared/seamlessLedgerTransitions.ts',{
  './ledger.ts': {
    postLedgerLegs: async (b,args) => {ledgerArgs=args;},
    applyBalanceHold: async (b,args) => {releaseArgs=args;},
  },
});
await settlement.postSeamlessSettlement(api,pending,Number(pending.amount),'check-test','test_settled');
assert.equal(ledgerArgs.legs[0].debit,100);
assert.equal(ledgerArgs.legs[1].creditHeld,100);
assert.equal(ledgerArgs.legs[1].totalDepositedDelta,100);
await settlement.releaseDepositAvailability(api,pending);
assert.equal(releaseArgs.amount,100);
assert.equal(pending.deposit_hold_status,'released');
console.log('PASS: 108,401 cent values, exact net credit, total debit, fee consent/tampering, retry deduplication, held settlement and release.');
