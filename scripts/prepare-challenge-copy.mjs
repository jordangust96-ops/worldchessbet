import fs from 'node:fs';
import { PUBLIC_LEGAL_DOCUMENTS } from './public-legal-snapshot.mjs';
// Only the operational invitation/preparation description changes. All
// eligibility, fee amounts, ACH, custody, dispute and winnings-hold text stays.
const rulesBefore = `Use Create Challenge to choose the offered Entry Amount and time control, or Join Challenge to accept another player's terms. Public and private challenges use the same eligibility and preparation checks. Creating or joining does not itself reserve funds. Before play begins, both players must complete readiness, fair-play certification, funding reservation, and fresh match-location checks.`;
const rulesAfter = `Challenge Someone creates a shareable invitation for a five-minute-per-player chess match with no increment. An unclaimed invitation normally expires after twenty-four hours. Creating, sharing or viewing a link, completing account setup, or initiating a deposit does not reserve an opponent or Contest funds. An unclaimed creator may play other matches or cancel the invitation. An ordinary shared link may be accepted by the first eligible, funded player who completes acceptance while the creator has enabled it; a rematch link may be restricted to the previous opponent.

The creator explicitly agrees to the disclosed Entry Amount, separate Platform Service Fee and Fair Play requirements and enables a short, two-minute acceptance window after the required account and match-location checks. This authorization itself reserves no funds. The recipient's final Accept & Reserve action rechecks both players' eligibility, availability and sufficient Available Balance. Both players' Entry Amounts and Platform Service Fees are committed together in one balanced financial journal operation before the opponent assignment is confirmed. Pending deposits, Clearing funds, pending winnings and other held funds cannot qualify a player. An unfinished wallet setup never claims the invitation.

After successful acceptance, both players must explicitly confirm readiness and remain present for the match to start. A two-minute start window applies. Unstarted matches are closed and reserved Entry Amounts and Platform Service Fees are released through the foreground recovery or scheduled timeout process; processing can occur after the displayed deadline. An interrupted response may require recovery of the same recorded financial operation and must not be treated as permission to submit another payment.

Find an Opponent retains the public marketplace and its separate preparation flow. Creating or joining a public listing does not itself reserve funds; each player confirms readiness and Fair Play and reserves the disclosed entry and fee during preparation. Both players must be funded and pass fresh match-location checks before either route starts gameplay. The same game, fair-play, settlement, reporting-window and winnings-release rules apply to both routes.`;
const termsBefore = `Creating or joining a challenge begins the matching and preparation process; it does not itself debit your balance. During preparation, each player confirms readiness and fair-play certification, and the Entry Amount plus separately disclosed fixed Platform Service Fee is reserved before play starts.`;
const termsAfter = `Creating or viewing a shared challenge link is a non-binding invitation and does not reserve an opponent or funds. Completing wallet setup or starting a deposit does not claim it. The creator explicitly authorizes the disclosed Entry Amount and separate Platform Service Fee for a short acceptance window. At the recipient's final Accept & Reserve action, both players are rechecked and both entries and fees are committed together before the opponent assignment is confirmed. Only sufficient Available Balance qualifies; pending or held funds do not. Both players then explicitly confirm readiness before gameplay. An unstarted claimed challenge is subject to the two-minute start window and the recovery/release process in the Official Rules. An unclaimed creator remains free to play elsewhere.

Public marketplace listings retain their preparation flow: creating or joining a public listing does not itself debit the balance; each player confirms readiness and Fair Play and reserves the entry plus separately disclosed fixed fee before play starts.`;
const changes={official_rules:[rulesBefore,rulesAfter],terms_of_service:[termsBefore,termsAfter]};
const drafts=[];
for(const [type,[before,after]] of Object.entries(changes)){
 const doc=PUBLIC_LEGAL_DOCUMENTS[type];
 if(!doc.markdown.includes(before))throw Error('Expected current operational paragraph missing: '+type);
 const content=doc.markdown.replace(before,after);
 drafts.push({policy_type:type,version:7,last_updated:'2026-09-14',support_email:doc.supportEmail,content_markdown:content,is_active:false});
}
fs.mkdirSync('docs/operations',{recursive:true});
fs.writeFileSync('docs/operations/challenge-policy-v7-drafts.json',JSON.stringify(drafts,null,2)+'\n');
// Update the crawlable snapshot only when invoked with --activate-snapshot,
// after the same prospective policy versions are published in the app.
if(process.argv.includes('--activate-snapshot')){
 let source=fs.readFileSync('scripts/public-legal-snapshot.mjs','utf8');
 for(const [before,after] of Object.values(changes))source=source.replace(before,after);
 for(const type of Object.keys(changes)){
  const start=source.indexOf(`  ${type}: {`),end=source.indexOf('  },',start);
  const section=source.slice(start,end).replace('version: "6.0"','version: "7.0"').replace('lastUpdated: "September 13, 2026"','lastUpdated: "September 14, 2026"');
  source=source.slice(0,start)+section+source.slice(end);
 }
 fs.writeFileSync('scripts/public-legal-snapshot.mjs',source);
}
console.log('Prepared prospective v7 operational copy only; no active policy records changed.');
