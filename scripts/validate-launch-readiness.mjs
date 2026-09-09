import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [
  fundingConfig,
  createLink,
  ensureCustomer,
  webhook,
  walletState,
  fundingPanel,
  walletPage,
  readinessProbe,
  complianceEvidence,
] = await Promise.all([
  read('base44/shared/seamlessFundingConfig.ts'),
  read('base44/functions/createSeamlessBankLinkUrl/entry.ts'),
  read('base44/functions/ensureSeamlessCustomer/entry.ts'),
  read('base44/functions/seamlessAchWebhook/entry.ts'),
  read('base44/functions/getSeamlessWalletState/entry.ts'),
  read('src/components/wallet/SeamlessFundingPanel.jsx'),
  read('src/pages/WalletPage.jsx'),
  read('base44/functions/getSeamlessOperationalReadiness/entry.ts'),
  read('base44/shared/complianceEvidence.ts'),
]);

assert.match(fundingConfig, /seamlessHostedPlaidEnabled/);
assert.match(createLink, /buildBankLinkUrl/);
assert.match(createLink, /AchDebitAuthorization\.create/);
assert.match(createLink, /trustedAppOrigin/);
assert.match(ensureCustomer, /PATH_CREATE_CUSTOMER/);
assert.match(webhook, /'funding-source\.verified'/);
assert.match(webhook, /syncHostedPlaidAccountState/);
assert.match(walletState, /hosted_plaid_enabled: seamlessHostedPlaidEnabled\(\)/);
assert.match(fundingPanel, /SeamlessPlaidBankLink/);
assert.doesNotMatch(walletPage, /IdentityVerificationPanel/);
assert.match(readinessProbe, /hosted_plaid_enabled: hostedPlaidEnabled/);
assert.match(complianceEvidence, /last_provider_event_id/);
assert.match(complianceEvidence, /funding_source_id: fundingSourceId/);

for (const source of [
  fundingConfig, createLink, ensureCustomer, webhook, walletState,
  fundingPanel, walletPage, readinessProbe, complianceEvidence,
]) {
  assert.doesNotMatch(source, /Socure|SOCURE|socure/);
}

async function collect(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (['dist', 'node_modules'].includes(entry.name)) continue;
    const child = join(dir, entry.name).replaceAll('\\\\', '/');
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
const ledgerIntegrity = await read('base44/functions/checkLedgerIntegrity/entry.ts');
assert.equal((ledger.match(/launch_epoch: 2/g) || []).length, 3);
assert.match(ledgerIntegrity, /LedgerEntry\.filter\(\{ launch_epoch: 2 \}/);
assert.match(ledgerIntegrity, /WalletTransaction\.filter\(\{ launch_epoch: 2 \}/);

console.log('Launch readiness validation passed.');
