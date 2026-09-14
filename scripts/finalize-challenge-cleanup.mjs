import fs from 'node:fs';
import path from 'node:path';
// Source-only cleanup. Historical records, ledger rows, bank authorizations,
// pending transfers, account settings and live matches are not touched.
const packagePath='package.json';
const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
pkg.scripts['test:challenges']='node scripts/validate-challenge-lifecycle.mjs';
fs.writeFileSync(packagePath,JSON.stringify(pkg,null,2)+'\n');
const userPath='base44/entities/User.jsonc';
const user=JSON.parse(fs.readFileSync(userPath,'utf8'));
for(const key of ['challenge_context_code','challenge_context_saved_at'])delete user.properties[key];
fs.writeFileSync(userPath,JSON.stringify(user,null,2)+'\n');
const allFiles=[];
function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const p=path.join(folder,entry.name);if(entry.isDirectory())walk(p);else allFiles.push(p);}}
walk('src');
const obsolete='src/components/play/PrivateWaitingCard.jsx';
const references=allFiles.filter(p=>p!==obsolete&&fs.readFileSync(p,'utf8').includes('PrivateWaitingCard'));
if(references.length)throw Error('Old private waiting UI still referenced: '+references.join(', '));
if(fs.existsSync(obsolete))fs.unlinkSync(obsolete);
for(const file of ['scripts/align-challenge-entrypoints.mjs','scripts/connect-challenge-ui.mjs','scripts/finalize-challenge-wiring.mjs']){
 if(fs.existsSync(file))fs.unlinkSync(file);
}
console.log('Added the repeatable challenge suite; removed unused private waiting UI, unused User context fields, and one-time migration scripts.');
