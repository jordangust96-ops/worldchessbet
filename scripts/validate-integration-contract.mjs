import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readJson = async (path) => JSON.parse(await read(path));

const walletTransaction = await readJson('base44/entities/WalletTransaction.jsonc');
const ledgerEntry = await readJson('base44/entities/LedgerEntry.jsonc');
const integrationEvent = await readJson('base44/entities/IntegrationEvent.jsonc');
const integrationReference = await readJson('base44/entities/IntegrationReference.jsonc');
const ledgerHelper = await read('base44/shared/ledger.ts');
const packetFunction = await read('base44/functions/getIntegrationPacket/entry.ts');

for (const field of [
  'currency',
  'direction',
  'correlation_id',
  'ledger_group_id',
  'source_event',
  'processed_at',
  'integration_status',
  'idempotency_key',
  'schema_version',
]) {
  assert.ok(walletTransaction.properties[field], `WalletTransaction missing ${field}`);
}

for (const field of ['correlation_id', 'game_id', 'currency', 'schema_version']) {
  assert.ok(ledgerEntry.properties[field], `LedgerEntry missing ${field}`);
}

for (const genericReference of [
  'provider_authorization',
  'provider_payment',
  'provider_transfer',
  'provider_payout',
  'provider_refund',
  'provider_reversal',
  'provider_dispute',
]) {
  assert.ok(
    ledgerEntry.properties.external_reference_type.enum.includes(genericReference),
    `LedgerEntry missing ${genericReference}`
  );
}

assert.equal(integrationEvent.name, 'IntegrationEvent');
assert.equal(integrationEvent.rls.delete, false);
assert.equal(integrationReference.name, 'IntegrationReference');
assert.equal(integrationReference.rls.delete, false);

for (const required of [
  'event_type',
  'occurred_at',
  'aggregate_type',
  'aggregate_id',
  'correlation_id',
  'idempotency_key',
  'actor_type',
]) {
  assert.ok(integrationEvent.required.includes(required), `IntegrationEvent must require ${required}`);
}

for (const token of [
  'correlation_id: correlationId',
  "currency: 'USD'",
  'schema_version: 1',
  'recordIntegrationEvent',
  'idempotency_key',
]) {
  assert.ok(ledgerHelper.includes(token), `Ledger helper missing contract token: ${token}`);
}

for (const token of [
  "contract: 'chessbet.funds_flow.integration_packet'",
  'ledger_groups_balanced',
  'transactions_without_ledger_links',
  'integration_references',
  'participants:',
]) {
  assert.ok(packetFunction.includes(token), `Integration packet missing contract token: ${token}`);
}

for (const prohibited of ['verified_id_hash', 'full_name', 'email:', 'pgn:', 'move_log:']) {
  assert.ok(!packetFunction.includes(prohibited), `Integration packet exposes prohibited field: ${prohibited}`);
}

const lifecycleSources = {
  'contest.created': 'base44/functions/createMatch/entry.ts',
  'contest.accepted': 'base44/functions/acceptMatch/entry.ts',
  'contest.fair_play_certified': 'base44/functions/certifyFairPlay/entry.ts',
  'contest.participant_funded': 'base44/functions/lockWager/entry.ts',
  'contest.started': 'base44/functions/finalizeMatchStart/entry.ts',
  'contest.cancelled': 'base44/functions/cancelMatch/entry.ts',
  'contest.settled': 'base44/functions/settleMatch/entry.ts',
  'dispute.opened': 'base44/functions/submitContestReport/entry.ts',
  'account.closed': 'base44/functions/closeAccount/entry.ts',
  'identity.socure_result_received': 'base44/functions/socureIdentityWebhook/entry.ts',
};

for (const [eventType, sourcePath] of Object.entries(lifecycleSources)) {
  const source = await read(sourcePath);
  assert.ok(source.includes(eventType), `${sourcePath} missing ${eventType}`);
}

console.log('Funds-flow integration contract validation passed.');
