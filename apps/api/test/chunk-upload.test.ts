import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {prepareBinary} from '../../web/src/binaryIntake.js';
import {binaryUploadRoute,uploadBinaryChunks} from '../../web/src/chunkUpload.js';
async function fixture(){const bytes=new Uint8Array(32769).fill(255);return {...await prepareBinary({name:'fictional.bin',size:bytes.length,arrayBuffer:async()=>bytes.buffer},'2026-01-12T09:00:00Z','Fictional chunk test'),idempotencyKey:randomUUID()};}
const state=(caseId:string)=>({id:randomUUID(),caseId,status:'open',byteLength:32769,chunkSize:32768,authorityVersion:1,expiresAt:'2099-01-01T00:00:00.000Z',evidenceId:null,received:[0]});
test('chunk client sends only missing exact ranges and respects pause before finalisation',async()=>{
 const caseId=randomUUID(),input=await fixture(),row=state(caseId),sent:number[]=[];
 const result=await uploadBinaryChunks(caseId,input,async(path,body)=>{
  if(path.endsWith('/chunk')){const p=body as {ordinal:number;contentBase64:string};sent.push(p.ordinal);assert.equal(p.contentBase64,'/w==');return {...row,received:[0,1]};}
  if(path.endsWith('/complete'))return {done:true};return row;
 });assert.deepEqual(result,{done:true});assert.deepEqual(sent,[1]);
 const controller=new AbortController();let calls=0;
 await assert.rejects(uploadBinaryChunks(caseId,input,async()=>{calls++;return row;},()=>controller.abort(),controller.signal),/stopped/);assert.equal(calls,2);
});
test('chunk client refuses foreign identities, forged ranges, changed provenance and acknowledgement gaps',async()=>{
 const caseId=randomUUID(),input=await fixture(),row=state(caseId);
 for(const changed of [{caseId:randomUUID()},{chunkSize:65536},{received:[0,0]},{received:[8]},{received:[0.5]}]){
  let calls=0;await assert.rejects(uploadBinaryChunks(caseId,input,async()=>++calls===1?row:{...row,...changed}));assert.equal(calls,2);
 }
 await assert.rejects(uploadBinaryChunks(caseId,input,async(path)=>path.endsWith('/chunk')?{...row,received:[0]}:row),/acknowledgement/);
 await assert.rejects(uploadBinaryChunks(caseId,input,async(path)=>path.endsWith('/chunk')?{...row,received:[0,1],authorityVersion:2}:row),/provenance/);
 await assert.rejects(uploadBinaryChunks(caseId,{...input,expectedSha256:'0'.repeat(64)},async()=>{throw Error('Must not send');}),/fingerprint/);
});
test('legacy pending keys keep the old upload route, including when a chunk retry also exists',()=>{
 const entries=new Map<string,string>(),store={getItem:(k:string)=>entries.get(k)??null};
 assert.deepEqual(binaryUploadRoute(store,'old'),{legacy:false,scope:'old:chunks-v1'});
 entries.set('old',JSON.stringify({key:randomUUID(),fingerprint:'a'.repeat(64)}));entries.set('old:chunks-v1','another pending record');
 assert.deepEqual(binaryUploadRoute(store,'old'),{legacy:true,scope:'old'});
 entries.set('old','corrupt');assert.throws(()=>binaryUploadRoute(store,'old'),/invalid/);
});
