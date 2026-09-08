import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBackend } from './helpers/load-backend.mjs';
const configPath = 'base44/shared/seamlessFundingConfig.ts';
const flags = ['SEAMLESS_DEPOSITS_ENABLED','SEAMLESS_WITHDRAWALS_ENABLED','SEAMLESS_RTP_PAYOUTS_ENABLED','SEAMLESS_THIRD_PARTY_FUNDING_ENABLED','PAID_CONTESTS_ENABLED'];
const names = ['seamlessDepositsEnabled','seamlessWithdrawalsEnabled','seamlessRtpPayoutsEnabled','seamlessThirdPartyFundingEnabled','paidContestsEnabled'];
let checks = 0;
const eq = (a,b,label) => { assert.equal(a,b,label); checks++; };
for (let mask = 0; mask < 64; mask++) {
  const env = { SEAMLESS_PROVIDER_APPROVED: mask & 32 ? 'true' : 'false' };
  flags.forEach((key,i) => { env[key] = mask & (1 << i) ? 'true' : 'false'; });
  const { exports: gates } = await loadBackend(configPath, {}, env);
  names.forEach((name,i) => eq(gates[name](), !!(mask & 32) && !!(mask & (1 << i)), name + ' combination ' + mask));
}
for (const value of [undefined,'','false','1','yes','tru']) {
  const { exports: gates } = await loadBackend(configPath, {}, { ...Object.fromEntries(flags.map(f=>[f,'true'])), SEAMLESS_PROVIDER_APPROVED:value });
  names.forEach(name=>eq(gates[name](),false,'unapproved fails closed'));
}
const { exports: gates } = await loadBackend(configPath, {}, Object.fromEntries(flags.map(f=>[f,'true'])));
const routes = ['submitSeamlessDeposit','submitSeamlessWithdrawal','createVerifiedSeamlessFundingSource','ensureSeamlessCustomer','requestSocureBankVerification','runContestEligibility','createMatch','acceptMatch','lockWager'];
for (const name of routes) {
  let effects = 0;
  const unexpected = () => { effects++; throw new Error('Unexpected side effect while disabled'); };
  const sdk = { auth:{me:async()=>({id:'fixture',role:'user',account_state:'verified'})}, asServiceRole:new Proxy({}, {get:unexpected}) };
  const path = 'base44/functions/' + name + '/entry.ts';
  const source = await readFile(new URL('../'+path,import.meta.url),'utf8');
  const deps = {};
  for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) deps[match[1]] = new Proxy({}, {get:()=>unexpected});
  deps['npm:@base44/sdk@0.8.38'] = {createClientFromRequest:()=>sdk};
  deps['../../shared/seamlessFundingConfig.ts'] = gates;
  const {handler} = await loadBackend(path,deps);
  const response = await handler(new Request('https://test.invalid',{method:'POST',body:'{}'}));
  const data = await response.json();
  eq(effects,0,name+' no entity/provider/lock effects');
  eq(data.enabled === false || data.action === 'paid_contests_disabled',true,name+' denied');
}
const publicPath = 'base44/functions/getLaunchAvailability/entry.ts';
const {handler} = await loadBackend(publicPath, {'../../shared/seamlessFundingConfig.ts':gates});
const response = handler();
eq(response.headers.get('Cache-Control'),'no-store','availability not cached');
const availability = await response.json();
eq(Object.values(availability).every(v=>v===false),true,'public availability fails closed');
eq(Object.keys(availability).length,4,'only public availability fields exposed');
console.log('Launch boundary checks passed: '+checks+' assertions; actual handlers, no network or records.');
