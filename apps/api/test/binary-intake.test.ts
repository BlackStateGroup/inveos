import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {prepareBinary,binaryIntakeScope,pendingBinary,sendBinaryRecoverably} from '../../web/src/binaryIntake.js';
const date='2026-01-12T09:00:00Z',method='Fictional supplied bytes';
const file=(bytes=new Uint8Array([0,255,13,10]))=>({name:'fictional.bin',size:bytes.length,arrayBuffer:async()=>bytes.buffer as ArrayBuffer});
const storage=()=>{const entries=new Map<string,string>();return {getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};};
const receipt=(caseId:string,input:Awaited<ReturnType<typeof prepareBinary>>)=>({id:randomUUID(),caseId,filename:input.filename,digest:input.expectedSha256,bytes:atob(input.contentBase64).length,sourceTime:input.sourceTime,method:input.method,originalKind:'opaque_binary',status:'Quarantined',text:''});
test('binary preparation preserves arbitrary bytes and refuses oversized files before reading',async()=>{
 const input=await prepareBinary(file(),date,method);assert.equal(input.contentBase64,'AP8NCg==');assert.match(input.expectedSha256,/^[a-f0-9]{64}$/);
 for(const size of [0,262145])await assert.rejects(prepareBinary({...file(),size,arrayBuffer:async()=>{throw Error('Must not read');}},date,method),/256 KiB/);
 await assert.rejects(prepareBinary({...file(),size:5},date,method),/size changed/);
 await assert.rejects(prepareBinary(file(),'2026-02-30T09:00:00Z',method));
 await assert.rejects(prepareBinary({...file(),name:'../original.bin'},date,method));
});
test('binary recovery retains exact operation after acknowledgement loss and rejects changed selections',async()=>{
 const store=storage(),caseId=randomUUID(),scope=await binaryIntakeScope('fictional-token-1234',caseId),input=await prepareBinary(file(),date,method);let key='';const saved=receipt(caseId,input);
 await assert.rejects(sendBinaryRecoverably(store,scope,caseId,input,async p=>{key=p.idempotencyKey;throw Error('lost receipt');}));
 assert.equal(pendingBinary(store,scope)!.key,key);assert.equal(store.getItem(scope)!.includes(method),false);
 await assert.rejects(sendBinaryRecoverably(store,scope,caseId,{...input,method:'Changed fictional method'},async()=>{throw Error('Must not send');}),/same file/);
 const recovered=await sendBinaryRecoverably({...store},scope,caseId,input,async p=>{assert.equal(p.idempotencyKey,key);return saved;});assert.deepEqual(recovered,saved);assert.equal(pendingBinary(store,scope),null);
 assert.notEqual(scope,await binaryIntakeScope('other-fictional-token',caseId));
});
test('binary intake rejects invalid receipts and unavailable retry storage; late completion cannot clear a new key',async()=>{
 const store=storage(),caseId=randomUUID(),input=await prepareBinary(file(),date,method),scope='test';
 await assert.rejects(sendBinaryRecoverably({...store,setItem:()=>{}},scope,caseId,input,async()=>{throw Error('Must not send');}),/Nothing was sent/);
 await assert.rejects(sendBinaryRecoverably(store,scope,caseId,input,async()=>({...receipt(caseId,input),status:'Verified'})),/receipt/);assert.ok(pendingBinary(store,scope));
 const next=randomUUID();await sendBinaryRecoverably(store,scope,caseId,input,async()=>{store.setItem(scope,JSON.stringify({...pendingBinary(store,scope),key:next}));return receipt(caseId,input);});assert.equal(pendingBinary(store,scope)!.key,next);
 store.setItem(scope,'broken');await assert.rejects(sendBinaryRecoverably(store,scope,caseId,input,async()=>{throw Error('Must not send');}),/invalid/);
});

test('cancelled retry reconciliation requires an exact terminal receipt and preserves changed or uncertain requests',async()=>{
 const {clearCancelledBinary}=await import('../../web/src/binaryIntake.js');const store=storage(),caseId=randomUUID(),scope='test:chunks-v1',pending={key:randomUUID(),fingerprint:'a'.repeat(64)};
 const save=()=>store.setItem(scope,JSON.stringify(pending));save();
 const confirmed={id:randomUUID(),caseId,requestKey:pending.key,status:'cancelled',evidenceId:null};
 for(const value of [{...confirmed,status:'open'},{...confirmed,status:'completed',evidenceId:randomUUID()},{...confirmed,caseId:randomUUID()},{...confirmed,requestKey:randomUUID()},{...confirmed,evidenceId:randomUUID()},{}]){
  await assert.rejects(clearCancelledBinary(store,scope,caseId,async()=>value),/not confirmed/);assert.deepEqual(pendingBinary(store,scope),pending);
 }
 await assert.rejects(clearCancelledBinary(store,scope,caseId,async()=>{throw Error('lost response');}));assert.deepEqual(pendingBinary(store,scope),pending);
 await assert.rejects(clearCancelledBinary(store,'legacy',caseId,async()=>confirmed),/Only chunk/);
 await assert.rejects(clearCancelledBinary(store,scope,caseId,async()=>{store.setItem(scope,JSON.stringify({...pending,key:randomUUID()}));return confirmed;}),/changed/);assert.ok(pendingBinary(store,scope));
 save();await assert.rejects(clearCancelledBinary({...store,removeItem:()=>{}},scope,caseId,async()=>confirmed),/could not be cleared/);
 await clearCancelledBinary(store,scope,caseId,async key=>{assert.equal(key,pending.key);return confirmed;});assert.equal(pendingBinary(store,scope),null);
});
