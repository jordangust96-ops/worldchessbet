import assert from 'node:assert/strict';
import { processSignupConfirmation } from '../base44/shared/signupConfirmation.js';
import { processValidateSession } from '../base44/shared/mfaVerify.js';
const user = { id:'signup-fixture', email:'fixture@example.com' };
const base = { email:user.email, otpCode:'123456', userAgent:'test-browser' };
let rows = [], calls = 0;
const store = {
  revokeSessions: async () => { rows.forEach(row => row.revoked = true); },
  createSession: async row => { rows.push(row); return row; },
  audit:async()=>{},
  getSessions: async (id, hash) => rows.filter(row => row.user_id === id && row.token_hash === hash),
  revokeSession:async()=>{}, 
};
const valid = async () => { calls++; return { user, access_token:'provider-verified-token' }; };
const run = extra => processSignupConfirmation({ ...base, store, verifyEmail:valid, ...extra });
assert.equal((await run({ otpCode:'bad' })).status,400);
assert.equal(calls,0);
assert.equal((await run({verifyEmail:async()=>{throw {status:429};}})).status,429);
assert.equal((await run({verifyEmail:async()=>{throw {status:400};}})).status,400);
assert.equal(rows.length,0);
assert.equal((await run({verifyEmail:async()=>({user})})).status,403);
assert.equal((await run({verifyEmail:async()=>({user:{...user,email:'another@example.com'},access_token:'token'})})).status,403);
assert.equal((await run({verifyEmail:async()=>({user:{...user,account_state:'suspended'},access_token:'token'})})).status,403);
assert.equal(rows.length,0);
const result = await run({});
assert.equal(result.status,200);
assert.equal(result.body.access_token,'provider-verified-token');
assert.ok(result.body.session_token.length>=32);
assert.equal(rows.length,1);
assert.notEqual(rows[0].token_hash,result.body.session_token);
assert.equal((await processValidateSession({user,sessionToken:result.body.session_token,store,userAgent:'test-browser'})).valid,true);
assert.equal((await processValidateSession({user,sessionToken:result.body.session_token,store,userAgent:'different-browser'})).valid,false);
assert.equal((await processValidateSession({user,sessionToken:result.body.session_token,store,userAgent:'test-browser',now:new Date(Date.parse(rows[0].expires_at)+1)})).valid,false);
const fallback = await run({store:{...store,createSession:async()=>{throw Error('storage unavailable');}}});
assert.equal(fallback.body.session_pending,true);
assert.equal(fallback.body.access_token,'provider-verified-token');
assert.equal(fallback.body.session_token,undefined);
console.log('Signup confirmation passed: valid proof, invalid/rate-limited codes, account mismatch/restriction, session binding/expiry, and recovery.');
