/** Explicit actual browser/HTTP/PostgreSQL acceptance; no local sandbox fallback. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {FieldContext,FieldDispatch,FieldSessionDetail,FieldSessionView,DispatchDetail,WorkItem} from '@inveos/contracts';
import {compositionTemplateBrowser} from './support/composition-template-browser.js';

test('sandboxed Field operations: offline session and corrected observations, separate delivery receipts and manual dispatch',{timeout:240000},async()=>{
  const h=await compositionTemplateBrowser('field-operations'),{f,browser}=h;
  const field='.field-workbench',sessions='[data-journey-panel="sessions"]',dispatch='[data-journey-panel="dispatch"]';
  const start='[data-journey-details="start"]',observation='[data-journey-details="observation"]',sync='[data-journey-details="sync"]';
  const manual='[data-journey-details="manual"]',operations='[data-journey-details="operations"]';
  const passphrase='fictional Field operations browser passphrase',sessionTitle='Fictional manual site visit';
  const sourceTime='2026-10-01T09:00:00+02:00',observationTitle='Fictional supplied dispatch observation';
  async function markPanel(title:string,key:string){await browser.evaluate(`(()=>{const headings=[...document.querySelectorAll('.field-workbench .panel-heading h2')].filter(e=>e.textContent===${JSON.stringify(title)});if(headings.length!==1)throw Error('Expected one Field panel');headings[0].closest('section.panel').setAttribute('data-journey-panel',${JSON.stringify(key)})()`);}
  async function markDetails(scope:string,label:string,key:string){await browser.evaluate(`(()=>{const nodes=[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('summary')].filter(e=>e.textContent.startsWith(${JSON.stringify(label)}));if(nodes.length!==1)throw Error('Expected one Field detail');nodes[0].parentElement.setAttribute('data-journey-details',${JSON.stringify(key)})()`);}
  async function openDetails(selector:string){if(!await browser.evaluate<boolean>(`document.querySelector(${JSON.stringify(selector)}).open`))await h.click(`document.querySelector(${JSON.stringify(selector)}).querySelector('summary')`);}
  async function openField(create=false){
    await h.navigate(f.investigator.headers,'Reports');await h.button('Field','[aria-label="Application surface"]');
    await h.fill('Local vault passphrase',passphrase,field);await h.button(create?'Create Field vault':'Unlock Field vault',field);
    await h.wait(`!!document.querySelector('[aria-label="Saved field context"]')`,'unlocked Field context controls');
    if(create)await h.button('Save current scope for offline capture',field);
    else {
      await h.wait(`document.querySelector('[aria-label="Saved field context"]').options.length>1`,'retained context loaded after unlock');
      const saved=await browser.evaluate<string>(`document.querySelector('[aria-label="Saved field context"]').options[1]?.value`);assert.ok(saved);
      await h.select('Saved capture context',saved,field);
    }
    await h.wait(`!!document.querySelector('[aria-label="Saved field authority"]')`,'saved exact authority');
    await markPanel('Field sessions and structured observations','sessions');await markPanel('Supervisor dispatch and shift records','dispatch');
    await markDetails(sessions,'Start, end or amend a session','start');await markDetails(sessions,'Structured sync and recovery console','sync');
  }
  async function offline(value:boolean){await browser.send('Network.emulateNetworkConditions',{offline:value,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
  async function row(scope:string,heading:string,key:string){await browser.evaluate(`(()=>{const matches=[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('article.field-capture')].filter(e=>e.querySelector('h3')?.textContent===${JSON.stringify(heading)});if(matches.length!==1)throw Error('Expected one original row '+${JSON.stringify(heading)});matches[0].setAttribute('data-journey-record',${JSON.stringify(key)})()`);return '[data-journey-record="'+key+'"]';}
  async function syncRecord(kind:string,title:string,key:string){
    const scope=await row(sync,kind+' · '+title,key);await h.button('Deliver frozen original',scope);
    await h.wait(`document.querySelector(${JSON.stringify(scope)}).textContent.includes('Original received · organisation unconfirmed')`,'original acknowledged independently');
    await h.button('Organise under selected scope',scope);
    await h.wait(`document.querySelector(${JSON.stringify(scope)}).textContent.includes('Organisation receipt confirmed')`,'organisation acknowledged separately');
    await h.button('Look up original receipt',scope);
    await h.wait(`!document.querySelector(${JSON.stringify(scope)}).querySelector('button:disabled')`,'original replay finished');
  }
  try{
    await openField(true);await offline(true);
    await h.fill('Session title',sessionTitle,start);await h.fill('Purpose within the saved case scope','Record supplied fictional observations during a manually declared visit.',start);
    await h.fill('Claimed event time, including timezone',sourceTime,start);await h.fill('Reason for this explicit event','Fictional investigator explicitly starts this session.',start);
    await h.check('This fictional record is within',start);await h.button('Save encrypted session event',start);
    await h.wait(`document.querySelector(${JSON.stringify(sessions)}).textContent.includes('Session event saved encrypted.')`,'offline session retained');
    await markDetails(sessions,'Record a structured observation','observation');await openDetails(observation);
    await h.fill('Observation title',observationTitle,observation);await h.select('Basis of the account','supplied_record',observation);
    await h.fill('Account — distinguish observation from inference','Fictional supplied account reports two unopened packages; truth remains unestablished.',observation);
    await h.fill('Source description','Fictional supplied dispatch record only.',observation);await h.fill('Consent / authority basis and limits','Fictional supplied material within saved authority; no live collection.',observation);
    await h.fill('Claimed observation/source time, including timezone','2026-10-01T09:05:00+02:00',observation);
    await h.check('Include a manually declared location',observation);await h.fill('Place description','Fictional site A loading room',observation);
    await h.fill('Why this location is necessary within the case purpose','Distinguish this fictional supplied account from other reported sites.',observation);
    await h.fill('Recording purpose and context','Fictional attributed observation for later independent assessment.',observation);
    await h.check('This fictional record is within',observation);await h.button('Save encrypted observation original',observation);
    await h.wait(`document.querySelector(${JSON.stringify(sessions)}).textContent.includes('Structured observation original saved encrypted.')`,'offline observation retained');
    await h.button('Prepare correction from this version',sessions);
    await h.fill('Account — distinguish observation from inference','Fictional correction: the supplied account reports three unopened packages; still unverified.',observation);
    await h.fill('Correction / withdrawal reason','Fictional explicit correction preserves the earlier supplied account.',observation);
    await h.check('This fictional record is within',observation);await h.button('Save encrypted correction original',observation);
    await h.wait(`document.querySelector(${JSON.stringify(sessions)}).textContent.includes('locally visible v2')`,'separate corrected local original');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,0,'offline writes created no server evidence');
    await h.captures('offline-corrected',sessions);await offline(false);
    // A new document and real unlock must recover the originals, not retain React state.
    await openField();
    await syncRecord('session_start',sessionTitle,'start-original');
    await syncRecord('observation_record',observationTitle,'observation-original');
    await syncRecord('observation_correct',observationTitle,'correction-original');
    const listed=await f.must<{items:FieldSessionView[]}>(f.base+'/field-sessions',undefined,f.investigator.headers);assert.equal(listed.items.length,1);
    const sessionId=listed.items[0]!.id,detail=await f.must<FieldSessionDetail>(f.base+'/field-sessions/'+sessionId,undefined,f.investigator.headers);
    assert.equal(detail.events.length,1);assert.equal(detail.events[0]!.record.sourceTime,sourceTime);
    assert.equal(detail.observations.length,1);assert.equal(detail.observations[0]!.history.length,2);assert.equal(detail.observations[0]!.latest.version,2);
    const originalHashes=detail.observations[0]!.history.map(x=>x.source.sha256);assert.equal(new Set(originalHashes).size,2);
    const contextRecord=detail.observations[0]!.latest.record;assert.equal(contextRecord.kind,'observation_correct');
    if(contextRecord.kind==='observation_correct'){assert.equal(contextRecord.location?.method,'manually_declared');assert.equal(contextRecord.location?.latitude,null);assert.equal(contextRecord.location?.longitude,null);assert.equal(contextRecord.location?.uncertaintyMetres,null);}
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM claims WHERE case_id=$1',[f.caseId])).rows[0].n,0,'organisation does not create a finding');
    await h.select('Session to work with',sessionId,sessions);await h.button('Read server session and correction history',sessions);
    await h.wait(`!!document.querySelector('[aria-label="Server Field session history"]')`,'server correction history');await h.captures('session-history','[aria-label="Server Field session history"]');
    // Dispatch publication is seeded through the real independently authorised API;
    // this journey exercises recipient controls and encrypted operational originals.
    const devices=await f.must<{items:{id:string}[]}>('/api/field/devices',undefined,f.investigator.headers);
    const context=await f.must<FieldContext>(f.base+'/field-context/'+devices.items[0]!.id,undefined,f.investigator.headers);
    const task=await f.must<WorkItem>(f.base+'/work',{id:randomUUID(),kind:'task',title:'Fictional manual visit task',body:'Report only fictional supplied material and manually declared status.',ownerId:f.investigator.id,dueDate:null,parentId:null},f.reviewer.headers);
    const id=randomUUID(),now=Date.now();
    const published=await f.must<FieldDispatch>(f.base+'/field-dispatch',{id,dispatchId:id,expectedVersion:0,expectedPublisherId:f.reviewer.id,authorityId:context.authority.id,authorityVersion:context.authority.version,caseAccessVersion:context.grant!.caseAccessVersion,recipientId:f.investigator.id,taskId:task.id,taskVersion:task.version,title:'Fictional manual visit instructions',instructions:'Acknowledge these fictional instructions and declare a manual check-in. No automatic monitoring.',prompts:[],ackDueAt:new Date(now+3600000).toISOString(),checkInDueAt:new Date(now+7200000).toISOString(),shiftEndsAt:new Date(now+10800000).toISOString(),state:'active',reason:'Fictional independent reviewer instructions for browser acceptance.'},f.reviewer.headers);
    await h.button('Refresh case dispatch board',dispatch);await h.button('Inspect and save these instructions offline',dispatch);
    await markDetails(dispatch,'Manual acknowledgement, check-in, incident or handover','manual');await markDetails(dispatch,'Encrypted operational delivery and recovery queue','operations');
    await offline(true);
    for(const kind of ['acknowledgement','check_in']){
      await h.select('Record kind',kind,manual);await h.fill('Account / shift context / incident details / handover contents','Fictional manual '+kind+' with no automatic location or safety assurance.',manual);
      if(kind==='check_in')await h.fill('Exact persisted session ID',sessionId,manual);
      await h.fill('Claimed source/event time with timezone','2026-10-01T09:10:00+02:00',manual);await h.fill('Record / correction reason','Fictional explicit '+kind+' within the saved instructions.',manual);
      await h.check('This fictional manual record is within',manual);await h.button('Save encrypted operational original',manual);
      await h.wait(`document.querySelector(${JSON.stringify(operations)}).querySelectorAll('article.field-capture').length===${kind==='acknowledgement'?1:2}`,'offline '+kind+' original');
    }
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM field_dispatch_originals WHERE case_id=$1',[f.caseId])).rows[0].n,0,'offline operational records not yet delivered');
    await h.captures('dispatch-offline',operations);await offline(false);
    const evidenceCount=(await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n;
    for(const [kind,status] of [['acknowledgement','acknowledged'],['check in','working']]){
      const scope=await row(operations,kind+' · '+status,kind!.replaceAll(' ','-'));
      await h.button('Deliver frozen operational original',scope);await h.wait(`document.querySelector(${JSON.stringify(scope)}).textContent.includes('Original acknowledged · application unconfirmed')`,'operational original receipt');
      await h.button('Apply to dispatch',scope);await h.wait(`document.querySelector(${JSON.stringify(scope)}).textContent.includes('Applied receipt confirmed')`,'separate dispatch application receipt');
    }
    const board=await f.must<DispatchDetail>(f.base+'/field-dispatch/'+published.dispatchId,undefined,f.investigator.headers);
    assert.equal(board.health.acknowledgement,'acknowledged');assert.equal(board.health.checkIn,'received');assert.equal(board.records.length,2);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,evidenceCount,'operational originals stay outside evidence');
    assert.deepEqual((await f.must<FieldSessionDetail>(f.base+'/field-sessions/'+sessionId)).observations[0]!.history.map(x=>x.source.sha256),originalHashes,'dispatch does not rewrite observation originals');
    await h.button('Refresh exact instructions and history',dispatch);await h.captures('dispatch-confirmed',dispatch);
    await h.button('Lock Field vault',field);await h.wait(`!!document.querySelector('[aria-label="Local vault passphrase"]')&&!document.querySelector(${JSON.stringify(sessions)})&&!document.querySelector(${JSON.stringify(dispatch)})`,'locked vault clears loaded operational records');
    assert.ok(!(await h.text(field)).includes(observationTitle));assert.ok(!(await h.text(field)).includes(published.instructions));
  }catch(error){await h.failure('field-operations',error);throw error;}finally{await offline(false).catch(()=>{});await h.close();}
});
