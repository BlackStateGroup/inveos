import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { pendingReportFreeze, recoverableReportFreeze, reportRecoveryScope, type RecoveryStore } from '../../web/src/reportRecovery.js';

// Storage double exercises the actual client protocol under Node. Not browser acceptance.
function storage(): RecoveryStore {
  const entries = new Map<string,string>();
  return {getItem: key => entries.get(key) ?? null, setItem: (key,value) => {entries.set(key,value);}, removeItem: key => {entries.delete(key);}};
}
const caseId = randomUUID();
const receipt = () => ({id: randomUUID(),caseId,status:'draft_not_released',sha256:'a'.repeat(64),createdAt:'2026-10-27T10:00:00Z'});

test('freeze recovery scope separates case and sign-in without persisting tokens or report content',async()=>{
  const csrf='fictional-session-one-long-token';
  const scope=await reportRecoveryScope(csrf,caseId);
  assert.equal(await reportRecoveryScope(csrf,caseId),scope);
  assert.notEqual(await reportRecoveryScope('fictional-session-two-long-token',caseId),scope);
  assert.notEqual(await reportRecoveryScope(csrf,randomUUID()),scope);
  assert.ok(!scope.includes(csrf));
  await assert.rejects(reportRecoveryScope('',caseId));
  await assert.rejects(reportRecoveryScope(csrf,'invalid'));
  const store=storage();let first='';
  await assert.rejects(recoverableReportFreeze(store,scope,caseId,async key=>{first=key;throw new Error('Fictional lost response');}),/lost response/);
  assert.equal(pendingReportFreeze(store,scope),first);
  const saved=receipt();
  assert.deepEqual(await recoverableReportFreeze({...store},scope,caseId,async key=>{assert.equal(key,first);return saved;}),saved);
  assert.equal(pendingReportFreeze(store,scope),null);
});

test('unavailable, corrupt or non-persistent retry storage prevents sending a freeze',async()=>{
  const broken=()=>{throw new Error('Unavailable');};
  const scopes='fictional-scope';let sent=0;
  for(const store of [
    {getItem:broken,setItem:broken,removeItem:broken},
    {getItem:()=>null,setItem:broken,removeItem:()=>{}},
    {getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
    {getItem:()=>'{corrupt}',setItem:()=>{},removeItem:()=>{}},
  ]) await assert.rejects(recoverableReportFreeze(store,scopes,caseId,async()=>{sent++;return receipt();}));
  assert.equal(sent,0);
});

test('unconfirmed or wrong-case receipts preserve the same retry key',async()=>{
  const store=storage(),scope='fictional-scope';let key='';
  for(const value of [null,{}, {...receipt(),caseId:randomUUID()}, {...receipt(),status:'released'}, {...receipt(),sha256:'invalid'}, {...receipt(),createdAt:'invalid'}]) {
    await assert.rejects(recoverableReportFreeze(store,scope,caseId,async next=>{if(key)assert.equal(next,key);key=next;return value;}),/could not be confirmed/);
    assert.equal(pendingReportFreeze(store,scope),key);
  }
});

test('delayed completion cannot clear a newer request and failed removal retains safe replay',async()=>{
  const store=storage(),scope='fictional-scope';
  let finish!:(value:unknown)=>void;
  const old=recoverableReportFreeze(store,scope,caseId,()=>new Promise(resolve=>{finish=resolve;}));
  const first=pendingReportFreeze(store,scope);
  const saved=receipt();
  await recoverableReportFreeze(store,scope,caseId,async key=>{assert.equal(key,first);return saved;});
  await assert.rejects(recoverableReportFreeze(store,scope,caseId,async()=>{throw new Error('lost second response');}));
  const second=pendingReportFreeze(store,scope);assert.notEqual(second,first);
  finish(saved);await old;assert.equal(pendingReportFreeze(store,scope),second);
  const cannotClear={...store,removeItem:()=>{}};
  await assert.rejects(recoverableReportFreeze(cannotClear,scope,caseId,async()=>receipt()),/could not be cleared/);
  assert.equal(pendingReportFreeze(store,scope),second);
  await recoverableReportFreeze(store,scope,caseId,async key=>{assert.equal(key,second);return receipt();});
  assert.equal(pendingReportFreeze(store,scope),null);
});
