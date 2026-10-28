import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {readOriginalDownload} from '../../web/src/originalDownload.js';
const bytes=new Uint8Array([0,255,13,10]),digest=createHash('sha256').update(bytes).digest('hex');
const evidence={bytes:bytes.length,digest,originalKind:'opaque_binary' as const,status:'Quarantined'};
const headers={'content-type':'application/octet-stream','x-inveos-original-state':'Quarantined'};
test('original downloader preserves exact binary bytes and verified text with bounded receipts',async()=>{
 assert.deepEqual(new Uint8Array(await readOriginalDownload(new Response(bytes,{headers}),evidence)),bytes);
 const text=new TextEncoder().encode('Fictional £\n');assert.deepEqual(new Uint8Array(await readOriginalDownload(new Response(text,{headers:{'content-type':'text/plain; charset=utf-8','x-inveos-original-state':'Verified'}}),{bytes:text.length,digest:createHash('sha256').update(text).digest('hex'),originalKind:'original_utf8',status:'Verified'})),text);
});
test('original downloader rejects corruption, truncation, excess bytes and mismatched state',async()=>{
 await assert.rejects(readOriginalDownload(new Response(new Uint8Array([0,255,13,11]),{headers}),evidence),/fingerprint/);
 await assert.rejects(readOriginalDownload(new Response(bytes.slice(1),{headers}),evidence),/incomplete/);
 await assert.rejects(readOriginalDownload(new Response(new Uint8Array(5),{headers}),evidence),/exceeds/);
 for(const changed of ([{'content-type':'text/html'},{'x-inveos-original-state':'Verified'},{'content-length':'3'}] as Record<string,string>[]))await assert.rejects(readOriginalDownload(new Response(bytes,{headers:{...headers,...changed}}),evidence),/mismatch/);
 for(const changed of [{bytes:262145},{bytes:0},{digest:'invalid'},{originalKind:undefined},{status:'Verified'}])await assert.rejects(readOriginalDownload(new Response(bytes,{headers}),{...evidence,...changed}));
 await assert.rejects(readOriginalDownload(new Response(null,{headers}),evidence),/no body/);
});
test('original downloader cancels denied or overlong streams without consuming their remainder',async()=>{
 for(const denied of [false,true]){
  let cancelled=false,pulls=0;
  const stream=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(5));},cancel(){cancelled=true;}},{highWaterMark:0});
  await assert.rejects(readOriginalDownload(new Response(stream,{status:denied?403:200,headers}),evidence),denied?/denied/:/exceeds/);assert.equal(cancelled,true);assert.equal(pulls,denied?0:1);
 }
});
