import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readDocumentPackageBytes,readVerifiedDocumentPackage,saveVerifiedDocumentPackage,verifyDocumentPackageDownload} from '../../web/src/documentPackageDownload.js';

const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
function fixture(){const report=new TextEncoder().encode('{"status":"draft_not_released","fictional":true}');const reportSha256=digest(report);const packageBytes=new TextEncoder().encode(JSON.stringify({format:'inveos_document_report_package_v1',reportSha256,reportBase64:Buffer.from(report).toString('base64'),exhibits:[{findingId:randomUUID()}]}));return {reportSha256,packageBytes,packageSha256:digest(packageBytes)};}
test('browser package guard binds exact package and embedded report bytes',async()=>{
 const f=fixture();assert.deepEqual(await verifyDocumentPackageDownload(f.packageBytes.buffer,f.reportSha256,f.packageSha256),{packageSha256:f.packageSha256,documentFindings:1});
 for(const value of [{header:null},{header:'0'.repeat(64)},{report:'0'.repeat(64)}])await assert.rejects(verifyDocumentPackageDownload(f.packageBytes.buffer,value.report??f.reportSha256,value.header===undefined?f.packageSha256:value.header),/fingerprints/);
 const changed=f.packageBytes.slice(),index=changed.length-2;changed[index]=changed[index]!^1;await assert.rejects(verifyDocumentPackageDownload(changed.buffer,f.reportSha256,digest(changed)),/fingerprints/);
 const replacement=new TextEncoder().encode(JSON.stringify({format:'inveos_document_report_package_v1',reportSha256:f.reportSha256,reportBase64:Buffer.from('replacement').toString('base64'),exhibits:[{}]}));await assert.rejects(verifyDocumentPackageDownload(replacement.buffer,f.reportSha256,digest(replacement)),/fingerprints/);
});
test('browser package reader bounds streamed bytes and verification receipt is scope bound',async()=>{
 assert.equal(new Uint8Array(await readDocumentPackageBytes(new Response('fictional'),9)).length,9);let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4));c.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}}));await assert.rejects(readDocumentPackageBytes(response,7),/size limit/);assert.equal(cancelled,true);
 const values=new Map<string,string>(),store={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};const receipt={caseId:randomUUID(),revisionId:randomUUID(),reportSha256:'a'.repeat(64),packageSha256:'b'.repeat(64),verifiedAt:new Date().toISOString()};saveVerifiedDocumentPackage(store,receipt);assert.deepEqual(readVerifiedDocumentPackage(store,receipt.caseId,receipt.revisionId,receipt.reportSha256),receipt);assert.equal(readVerifiedDocumentPackage(store,receipt.caseId,randomUUID(),receipt.reportSha256),null);assert.equal(readVerifiedDocumentPackage(store,receipt.caseId,receipt.revisionId,'c'.repeat(64)),null);
});
