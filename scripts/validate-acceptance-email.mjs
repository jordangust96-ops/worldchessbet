import assert from 'node:assert/strict';
import {fixture} from './free-play-test-fixture.mjs';
import {buildMatchAcceptedEmail,MATCH_EMAIL_LOGO} from '../base44/shared/matchAcceptedEmail.js';
async function setup(){const f=fixture();const m=await f.create();await f.api.acceptChallenge(f.request,f.sdk,f.user('p2'),f.get(m.id),f.consent);Object.assign(f.table('User')[0],{role:'admin',email:'fixture@example.invalid'});return {...f,m,send:()=>f.makeSdk('p1').functions.invoke('notifyMatchAccepted',{matchId:m.id})};}
{
 const f=await setup();f.state.fail={where:'Match.update',test:(_,patch)=>patch.accept_notification_sent===true};
 assert.equal((await f.send()).data.status,'sent');assert.equal(f.state.emails.length,1);
 assert.equal(f.table('EmailLog')[0].reason,'provider_accepted');assert.notEqual(f.get(f.m.id).accept_notification_sent,true);
 assert.equal((await f.send()).data.reason,'already_sent');assert.equal(f.state.emails.length,1);assert.equal(f.get(f.m.id).accept_notification_sent,true);
 console.log('PASS provider receipt prevents resend after marker failure');
}
{
 const f=await setup();f.state.fail={where:'EmailLog.create.before'};
 assert.equal((await f.send()).data.status,'sent');assert.equal(f.get(f.m.id).accept_notification_sent,true);
 await f.send();assert.equal(f.state.emails.length,1);console.log('PASS audit outage does not resend provider-accepted email');
}
for(const [status,reason] of [['in_progress','play_already_started'],['cancelled','cancelled'],['completed','play_already_started']]){
 const f=await setup();f.table('Match')[0].status=status;
 assert.equal((await f.send()).data.reason,reason);assert.equal(f.table('EmailLog')[0].reason,reason);assert.equal(f.state.emails.length,0);
}
{
 const f=await setup();f.table('User').splice(1,1);f.table('Match')[0].player1_id='missing-user';
 assert.equal((await f.send()).data.status,'failed');assert.equal(f.state.emails.length,0);console.log('PASS temporary lookup errors return workflow retry contract');
}
for(const free of [true,false]){
 const html=buildMatchAcceptedEmail({opponentName:'<script>bad</script>',wagerAmount:25,timeControlLabel:'Blitz (5+0)',appUrl:'https://worldchessbet.com',matchId:'sample',deadline:'Sep 15, 10:00 PM EDT',free});
 assert.ok(html.includes(MATCH_EMAIL_LOGO));assert.match(html,/alt="ChessBet logo"/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 assert.match(html,/\/play\?match=sample/);assert.match(html,/Play Now/);assert.match(html,/Return before/);
 if(free)assert.doesNotMatch(html,/Entry Amount|\$25|money/i);else {assert.match(html,/\$25.00/);assert.doesNotMatch(html,/Free play/);}
}
console.log('PASS branded free/money email, logo, escaped content, deadline and direct link');

{
 const f=await setup();f.state.fail={where:'SendEmail'};
 assert.equal((await f.send()).data.status,'failed');assert.equal(f.state.emails.length,0);
 assert.notEqual(f.get(f.m.id).accept_notification_sent,true);assert.equal(f.table('EmailLog')[0].reason,'provider_error');
 assert.equal((await f.send()).data.status,'sent');assert.equal(f.state.emails.length,1);
 console.log('PASS provider failure records error and retries without premature sent marker');
}
