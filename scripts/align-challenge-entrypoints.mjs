// Source-only compatibility migration. No data, secrets, provider calls, or ledger actions.
import fs from 'node:fs';
const changed = new Map();
const guard = `\n    // New invitations must not enter the retired accept-then-fund pathway.\n    if (Number(match.challenge_version) === 1) return Response.json({\n      error: 'Use the challenge invitation to continue.', action: 'use_challenge_flow',\n    }, { status: 409 });\n`;
const marker = "    if (Number(match.launch_epoch) !== 2) return Response.json({ error: 'Match not available' }, { status: 410 });";
for (const file of ['base44/functions/acceptMatch/entry.ts','base44/functions/cancelMatch/entry.ts',
  'base44/functions/certifyFairPlay/entry.ts','base44/functions/confirmMatchReadiness/entry.ts',
  'base44/functions/finalizeMatchStart/entry.ts','base44/shared/lockWager.ts']) {
  const source = fs.readFileSync(file,'utf8');
  if (source.includes('use_challenge_flow')) continue;
  if (!source.includes(marker)) throw Error(`Expected epoch guard missing: ${file}`);
  changed.set(file, source.replace(marker, marker + guard));
}
const create = 'base44/functions/createMatch/entry.ts';
let source = fs.readFileSync(create,'utf8');
if (!source.includes('use_challenge_flow')) {
  const marker = '    const { wagerAmount, timeControl, isPrivate } = await req.json();';
  if (!source.includes(marker)) throw Error('Expected create request missing');
  source = source.replace(marker, marker + `\n    if (isPrivate) return Response.json({\n      error: 'Create shared invitations through Challenge Someone.', action: 'use_challenge_flow',\n    }, { status: 409 });`);
  source = source.replace('entryAmount: wager,', 'entryAmount: Math.round((wager + platformServiceFee) * 100) / 100,');
  changed.set(create, source);
}
for (const [file, code] of changed) fs.writeFileSync(file, code);
console.log(`Aligned ${changed.size} legacy entrypoints. Shared invitations cannot use the legacy single-side reservation flow.`);
