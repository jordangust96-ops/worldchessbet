import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {loadBackend} from './helpers/load-backend.mjs';
const secret=webcrypto.getRandomValues(new Uint8Array(32));
const {exports:archive}=await loadBackend('base44/shared/kycEvidenceArchive.ts',{},
 {KYC_AUDIT_ENCRYPTION_KEY:Buffer.from(secret).toString('base64url')});
const evidence={decision:'ACCEPT',data_enrichments:Array.from({length:150},(_,i)=>({index:i,request:{firstName:'Test',surName:'Player'},response:{report:'Evidence must be retained exactly. '.repeat(100)}}))};
const key=await webcrypto.subtle.importKey('raw',secret,'AES-GCM',false,['decrypt']);
for(const compress of [false,true]){
 const result=await archive.encryptComplianceJson(evidence,{compress});
 const prefix='gzip-aesgcm-v1:';
 assert.equal(result.ciphertext.startsWith(prefix),compress);
 const encoded=compress?result.ciphertext.slice(prefix.length):result.ciphertext;
 const decrypted=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(result.iv,'base64')},key,Buffer.from(encoded,'base64'));
 const recovered=compress?await new Response(new Blob([decrypted]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(decrypted);
 assert.equal(recovered,JSON.stringify(evidence));
 assert.equal(result.sha256,await archive.sha256Text(recovered));
 if(compress)assert.ok(result.ciphertext.length<10000,'large repetitive report fits compactly');
 const tampered=Buffer.from(encoded,'base64');tampered[0]^=1;
 await assert.rejects(webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(result.iv,'base64')},key,tampered));
}
console.log('Evidence archive: large-report compression, lossless decrypt/decompress, original hash, legacy format and tamper rejection passed.');
