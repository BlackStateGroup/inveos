import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {jobRequestScope,pendingJob,queueRecoverably,type PendingJob} from '../../web/src/jobRequest.js';
function store(){const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);}};}
const caseId=randomUUID(),input={evidenceId:randomUUID(),kind:'utf8_line_index_v1' as const};
const receipt=(p:PendingJob)=>({id:randomUUID(),caseId,evidenceId:p.evidenceId,kind:p.kind,status:'queued'});
test('queue recovery retains exact operation across remount even when the new form chooses another source',async()=>{
  const scope=await jobRequestScope('fictional-long-session-token',caseId),storage=store();let previous!:PendingJob;
  await assert.rejects(queueRecoverably(storage,scope,caseId,input,async p=>{previous=p;throw new Error('lost');}));
  await queueRecoverably({...storage},scope,caseId,{evidenceId:randomUUID(),kind:'original_sha256_v1'},async p=>{assert.deepEqual(p,previous);return receipt(p);});
  assert.equal(pendingJob(storage,scope),null);
  assert.notEqual(await jobRequestScope('fictional-other-session-token',caseId),scope);
  assert.notEqual(await jobRequestScope('fictional-long-session-token',randomUUID()),scope);
});
test('queue storage failure and malformed pending input fail before send; invalid receipts retain recovery',async()=>{
  let sent=0;
  for(const storage of [{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},{getItem:()=>'{bad',setItem:()=>{},removeItem:()=>{}}])
    await assert.rejects(queueRecoverably(storage,'scope',caseId,input,async p=>{sent++;return receipt(p);}));
  assert.equal(sent,0);
  const storage=store();await assert.rejects(queueRecoverably(storage,'scope',caseId,input,async p=>({...receipt(p),caseId:randomUUID()})));
  assert.ok(pendingJob(storage,'scope'));
});
test('late queue receipts cannot clear a newer pending request and terminal receipts are valid recoveries',async()=>{
  const storage=store();let finish!:(v:unknown)=>void;let first!:PendingJob;
  const old=queueRecoverably(storage,'scope',caseId,input,p=>{first=p;return new Promise(r=>{finish=r;});});
  await queueRecoverably(storage,'scope',caseId,input,async p=>({...receipt(p),status:'succeeded'}));
  await assert.rejects(queueRecoverably(storage,'scope',caseId,input,async()=>{throw new Error('lost newer');}));
  const newer=pendingJob(storage,'scope');finish(receipt(first));await old;
  assert.deepEqual(pendingJob(storage,'scope'),newer);
});
