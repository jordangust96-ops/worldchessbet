import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const fundingConfig = await read('base44/shared/seamlessFundingConfig.ts');
const deposit = await read('base44/functions/submitSeamlessDeposit/entry.ts');
const withdrawal = await read('base44/functions/submitSeamlessWithdrawal/entry.ts');
const walletState = await read('base44/functions/getSeamlessWalletState/entry.ts');
const fundingPanel = await read('src/components/wallet/SeamlessFundingPanel.jsx');

assert.ok(fundingConfig.includes("enabled('SEAMLESS_DEPOSITS_ENABLED')"));
assert.ok(fundingConfig.includes("enabled('SEAMLESS_WITHDRAWALS_ENABLED')"));
assert.ok(fundingConfig.includes("enabled('SEAMLESS_THIRD_PARTY_FUNDING_ENABLED')"));
assert.ok(deposit.includes('if (!seamlessDepositsEnabled())'));
assert.ok(withdrawal.includes('if (!seamlessWithdrawalsEnabled())'));
assert.ok(withdrawal.indexOf('if (!seamlessWithdrawalsEnabled())') < withdrawal.indexOf('seamlessRequest('));
assert.ok(withdrawal.indexOf('if (!seamlessWithdrawalsEnabled())') < withdrawal.indexOf('const reservationGroupId = await reserveWithdrawal'));
assert.ok(walletState.includes('withdrawals_enabled: withdrawalsEnabled'));
assert.ok(fundingPanel.includes('!withdrawalsEnabled'));
assert.ok(fundingPanel.includes('transferDirectionEnabled'));
assert.ok(fundingPanel.includes('VerifiedThirdPartyFundingSourceForm'));
assert.ok(!fundingPanel.includes('createSeamlessBankLinkUrl'));

const legalName = await read('base44/shared/legalName.ts');
const setLegalName = await read('base44/functions/setFundingLegalName/entry.ts');
const register = await read('src/pages/Register.jsx');
const identityPanel = await read('src/components/wallet/SocureIdentityVerificationPanel.jsx');
const identityStart = await read('base44/functions/startSocureIdentityVerification/entry.ts');
const ensureCustomer = await read('base44/functions/ensureSeamlessCustomer/entry.ts');
const bankScreening = await read('base44/functions/requestSocureBankVerification/entry.ts');
const thirdPartyEnrollment = await read('base44/functions/createVerifiedSeamlessFundingSource/entry.ts');
const readiness = await read('base44/functions/getSeamlessOperationalReadiness/entry.ts');
const complianceEvidence = await read('base44/shared/complianceEvidence.ts');

assert.ok(legalName.includes('normalizeLegalNameParts'));
assert.ok(setLegalName.includes('await base44.auth.me()'));
assert.ok(setLegalName.includes('base44.asServiceRole.entities.User.update(user.id'));
assert.ok(!setLegalName.includes('body?.userId'));
assert.ok(register.includes('Legal first name') && register.includes('Legal last name'));
assert.ok(register.includes('setFundingLegalName'));
assert.ok(identityPanel.includes('Confirm your legal name'));
assert.ok(identityPanel.includes('setFundingLegalName'));
assert.ok(identityStart.includes('legalNameFromUser(user)'));
assert.ok(ensureCustomer.includes('legalNameFromUser(user)'));
assert.ok(bankScreening.includes('legalNameFromUser(user)'));
assert.ok(thirdPartyEnrollment.includes('ACH_AUTHORIZATION_TEXT'));
assert.ok(thirdPartyEnrollment.includes('evaluateSocureBankAccount'));
assert.ok(thirdPartyEnrollment.indexOf('evaluateSocureBankAccount') < thirdPartyEnrollment.indexOf('providerRequestStarted = true'));
assert.ok(readiness.includes('identity_workflow_configured'));
assert.ok(readiness.includes('compliance_evidence_configured'));
assert.ok(complianceEvidence.includes('extendComplianceEvidenceRetention'));

const pooledPlan = await read('docs/architecture/deferred-pooled-account.md');
assert.ok(pooledPlan.includes('implemented for publish readiness'));
assert.ok(pooledPlan.includes('merchant-pool level'));
assert.ok(pooledPlan.includes('SEAMLESS_DEPOSITS_ENABLED'));
assert.ok(pooledPlan.includes('SEAMLESS_WITHDRAWALS_ENABLED'));
assert.ok(pooledPlan.includes('Implemented identifier mapping'));

const pooledReconciliation = await read('base44/functions/record-seamless-merchant-balance-snapshot/entry.ts');
assert.ok(pooledReconciliation.includes('reconcileSeamlessMerchantBalance'));
assert.ok(pooledReconciliation.includes("provider_balance_scope: 'merchant_pool'"));
assert.ok(pooledReconciliation.includes("player_balance_scope: 'internal_ledger'"));
assert.ok(pooledReconciliation.includes('requireAdminMfa'));

async function collect(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (['dist', 'node_modules'].includes(entry.name)) continue;
    const child = join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) output.push(...await collect(child + '/'));
    else output.push(child);
  }
  return output;
}

for (const file of [...await collect('src/'), ...await collect('base44/functions/'), ...await collect('base44/shared/')]) {
  const source = await read(file);
  assert.ok(!source.includes('EARLY_ACCESS_MODE'), `${file} still contains EARLY_ACCESS_MODE`);
  assert.ok(!source.includes('Early Access'), `${file} still contains player/runtime Early Access wording`);
}

const ledger = await read('base44/shared/ledger.ts');
const disputeManagement = await read('base44/functions/manageDisputeCase/entry.ts');
const ledgerIntegrity = await read('base44/functions/checkLedgerIntegrity/entry.ts');
const operationsBrief = await read('base44/functions/generateDailyOperationsBrief/entry.ts');
const ledgerEntrySchema = await read('base44/entities/LedgerEntry.jsonc');
const walletTransactionSchema = await read('base44/entities/WalletTransaction.jsonc');

assert.equal((ledger.match(/launch_epoch: 2/g) || []).length, 3, 'Every shared ledger entry must be launch-scoped');
const disputeFinancialCreates = disputeManagement.match(/entities\.(?:LedgerEntry|WalletTransaction)\.create\(\{/g) || [];
assert.ok(disputeFinancialCreates.length > 0);
assert.equal((disputeManagement.match(/launch_epoch: 2/g) || []).length, disputeFinancialCreates.length, 'Every dispute financial record must be launch-scoped');
assert.ok(ledgerIntegrity.includes('LedgerEntry.filter({ launch_epoch: 2 }'));
assert.ok(ledgerIntegrity.includes('WalletTransaction.filter({ launch_epoch: 2 }'));
assert.ok(operationsBrief.includes("Match.filter({ launch_epoch: 2, status: 'in_progress' }"));
assert.ok(operationsBrief.includes("LedgerEntry.filter({ launch_epoch: 2, ledger_account: 'settlement' }"));
assert.ok(ledgerEntrySchema.includes('"launch_epoch"'));
assert.ok(walletTransactionSchema.includes('"launch_epoch"'));

console.log('Launch readiness validation passed.');
