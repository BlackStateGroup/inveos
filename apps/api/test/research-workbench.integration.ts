/** Explicit hosted acceptance definition. Never run with --no-sandbox or mocked API responses.
 * npm run build -w @inveos/web
 * node --import tsx --test --test-concurrency=1 apps/api/test/research-workbench.integration.ts
 * Requires existing restricted/admin inveos_test URLs, Node 22, sandbox-capable Chrome, Python 3.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {ConnectorPolicyVersion,ResearchRequest,ResearchRequestEntry,ResearchRun,ResearchProvenance} from '@inveos/contracts';
import {researchBrowserFixture,researchControls,launchBrowser,eventually,hash,type ResearchSession,type HostBrowser} from './support/research-browser.js';

type State={requests:ResearchRequestEntry[];runs:ResearchRun[]};
type Detail={run:ResearchRun;request:ResearchRequest;provenance:ResearchProvenance|null;events:{status:string}[]};
const saved='section[aria-label="Saved research requests"]';
const detail='article[aria-label="Research run detail"]';
const requestHistory='article[aria-label="Research request history"]';
const policyForm='form[aria-label="Propose research source policy"]';
const requestForm='form[aria-label="Save research request"]';
const captureForm='form[aria-label="Supply original capture"]';
const policies=[
 {adapter:'rdap_domain_v1',endpoint:'https://rdap.example.test/domain/',target:'example.test',file:'rdap-domain-fictional.json',media:'application/rdap+json',field:'FICTIONAL-DOMAIN-001'},
 {adapter:'supplied_webpage_v1',endpoint:'https://supplier.example.test/',target:'https://supplier.example.test/declaration',file:'supplied-webpage-fictional.html',media:'text/html',field:''},
 {adapter:'gleif_lei_v1',endpoint:'https://api.gleif.org/api/v1/lei-records/',target:'000000FICTIONAL00040',file:'gleif-lei-fictional.json',media:'application/vnd.api+json',field:'Fictional Northstar Paperworks Limited - not a registered entity'},
] as const;

for(const spec of policies)test(`sandboxed research workbench: ${spec.adapter} supplied capture, versions, history and access`,{timeout:240000},async t=>{
 const f=await researchBrowserFixture();let browser:HostBrowser|undefined;
 const artifacts=resolve(process.env.INVEOS_ACCEPTANCE_ARTIFACTS||'output/evals/research-workbench',spec.adapter);
 await mkdir(artifacts,{recursive:true});
 try {
  browser=await launchBrowser();const b=browser,ui=researchControls(b),base=f.base+'/research',policy='/api/connector-policies/'+spec.adapter;
  await b.send('Network.enable');await b.send('Page.enable');
  await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const downloads=join(f.db.storage,'downloads');await mkdir(downloads);
  await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  const now=Date.now(),policyExpiry=new Date(now+3600000).toISOString(),requestExpiry=new Date(now+1800000).toISOString();
  const title='Fictional '+spec.adapter+' question',publisher='Fictional '+spec.adapter+' publisher';
  const sourceTime='2026-10-01T09:00:00+02:00',retrievedAt='2026-10-02T10:00:00Z';
  const original=await readFile(fileURLToPath(new URL('../../../tests/fixtures/'+spec.file,import.meta.url)));
  // This extra first-party sentinel is an inert supplied original, never a fixture server response.
  const bytes=spec.adapter==='supplied_webpage_v1'?Buffer.concat([original,Buffer.from('\n<script>window.__fictionalResearchExecuted=true</script><img src="'+f.origin+'/fictional-research-trap" alt="fictional inert sentinel">')]):original;
  const path=join(f.db.storage,spec.file);await writeFile(path,bytes);
  const invalid=join(f.db.storage,'fictional-invalid-utf8.'+(spec.adapter==='supplied_webpage_v1'?'html':'json'));await writeFile(invalid,Buffer.from([0xff,0xfe,0xfd]));
  const runCss=(id:string)=>`[data-research-run-id="${id}"]`;
  const state=()=>f.must<State>(base);
  const getRun=(id:string)=>f.must<Detail>(base+'/runs/'+id);
  async function navigate(actor:ResearchSession){
   await ui.cookies(actor,f.origin);
   await b.send('Page.navigate',{url:f.origin+'/#case='+f.caseId+'&view=Research'});
   await ui.wait(`document.querySelector('select[aria-label="Research source workflow"]')?.matches(':enabled')`,'case Research workflow selector');
   await ui.select('select[aria-label="Research source workflow"]',spec.adapter);
   await ui.textIncludes('Live provider activation is disabled.');
   await ui.wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Refresh research requests'&&e.matches(':enabled'))`,'research loaded');
  }
  async function openPolicy(){
   await ui.clickCss('details:has(form[aria-label="Propose research source policy"]) > summary');
  }
  async function proposePolicy(version:number){
   if(spec.adapter==='gleif_lei_v1'){
    assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(policyForm+' [name="endpointScope"]')}).readOnly`),true);
    assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(policyForm+' [name="endpointScope"]')}).value`),spec.endpoint);
   }else await ui.fill(policyForm+' [name="endpointScope"]',spec.endpoint);
   for(const [name,value] of Object.entries({purpose:'Fictional supplied browser capture only',lawfulBasis:'Invented data only; no live-provider approval claimed',termsReference:'https://terms.example.test/fictional-browser-v'+version,termsSha256:hash('Fictional browser terms '+version),minimisation:'Only bounded fictional originals; no linked person or resource traversal',validUntil:policyExpiry,reason:'Fictional policy version '+version+' for browser acceptance'}))await ui.fill(policyForm+` [name="${name}"]`,value);
   await ui.submit('Propose research policy',policyForm);
   await ui.textIncludes('Policy version '+version+' · candidate');
  }
  async function saveRequest(version:number){
   if(version>1){await ui.click('Correct request',saved);await ui.textIncludes('Correct request version '+(version-1),requestForm);}
   for(const [name,value] of Object.entries({title:version===1?title:title+' corrected',target:spec.target,purpose:'Preserve bounded fictional source context version '+version,minimisation:'No linked personal, ownership or contact traversal',validUntil:requestExpiry,reason:'Fictional request version '+version+' deliberately selected'}))await ui.fill(requestForm+` [name="${name}"]`,value);
   await ui.submit('Save request version',requestForm);await ui.textIncludes('version '+version,saved);
   const record=(await state()).requests.find(x=>x.request.adapterId===spec.adapter)!.request;assert.equal(record.version,version);return record;
  }
  async function queue(previous?:string){
   const before=(await state()).runs.map(x=>x.id);
   await ui.click(previous?'Explicitly re-run same version':'Choose and queue supplied capture',previous?runCss(previous):saved);
   await ui.wait(`document.querySelector(${JSON.stringify(captureForm)})?.querySelector('input[type="file"]')?.matches(':enabled')`,'queued supplied-file controls');
   const added=(await state()).runs.filter(x=>!before.includes(x.id));assert.equal(added.length,1,'one explicit queue action creates one run');
   assert.equal(added[0]!.executionMode,'supplied');assert.equal(added[0]!.previousRunId,previous??null);return added[0]!.id;
  }
  async function supply(file=path,mode='controlled_response'){
   await ui.file(captureForm+' input[type="file"]',file);
   await ui.select(captureForm+' [name="mediaType"]',spec.media);
   if(spec.adapter!=='supplied_webpage_v1')await ui.select(captureForm+' [name="captureMode"]',mode);
   for(const [name,value] of Object.entries({publisher,sourceTime,retrievedAt}))await ui.fill(captureForm+` [name="${name}"]`,value);
   await ui.clickCss(captureForm+' input[type="checkbox"]');await ui.submit('Preserve supplied original',captureForm);
  }
  async function successful(id:string,version:number,mode:string){
   await ui.textIncludes('Preserved capture receipt',detail);const d=await getRun(id);assert.equal(d.run.status,'succeeded');assert.ok(d.run.evidenceId&&d.run.sourceId&&d.provenance);
   const receipt=d.provenance.payload.receipt;
   assert.equal(receipt.originalSha256,hash(bytes));assert.equal(receipt.byteLength,bytes.length);assert.equal(receipt.requestVersion,version);assert.equal(receipt.captureMode,mode);assert.equal(receipt.networkRequests,0);
   assert.equal(receipt.sourceTime,sourceTime);assert.equal(receipt.retrievedAt,retrievedAt);assert.notEqual(receipt.receivedAt,sourceTime);assert.notEqual(receipt.receivedAt,retrievedAt);
   assert.equal(receipt.endpointScope,spec.endpoint);assert.equal(receipt.credentialScope,'none:controlled-input');assert.equal(receipt.policyVersion,1);assert.equal(receipt.authorityVersion,1);
   assert.deepEqual(d.events.map(x=>x.status),['queued','running','succeeded']);
   await ui.textIncludes(hash(bytes),detail);await ui.textIncludes('0 network requests',detail);await ui.textIncludes(sourceTime,detail);await ui.textIncludes(retrievedAt,detail);
   const shown=await ui.text(detail);if(spec.field)assert.ok(shown.includes(spec.field));else assert.deepEqual(receipt.fields,[]);
   for(const omitted of ['FICTIONAL-CONTACT-DO-NOT-EXTRACT','never-follow.example.test','vcardArray','relationships'])assert.ok(!JSON.stringify(receipt.fields).includes(omitted),'not extracted: '+omitted);
   assert.ok(!shown.includes('FICTIONAL-CONTACT-DO-NOT-EXTRACT'));
   const download=await f.call(f.base+'/evidence/'+d.run.evidenceId+'/original');assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
   assert.match(download.headers.get('content-type')||'',/^text\/plain/);assert.match(download.headers.get('content-disposition')||'',/^attachment/);assert.equal(download.headers.get('x-content-type-options'),'nosniff');
   const permission=await f.must<{analysisAllowed:boolean;releaseAllowed:boolean}>(f.base+'/manual-sources/'+d.run.sourceId+'/use-decisions');assert.equal(permission.analysisAllowed,false);assert.equal(permission.releaseAllowed,false);
   return d;
  }

  // Policies and request records are created by browser controls, not fixture setup.
  await navigate(f.owner);await ui.textIncludes('No source policy');await openPolicy();await proposePolicy(1);
  assert.equal(await b.evaluate(`!!document.querySelector(${JSON.stringify(requestForm)})`),false,'candidate policy cannot authorise request');
  assert.ok(!(await ui.text()).includes('Accept policy'),'author cannot approve their own policy');
  const self=await f.call(policy+'/1/review',f.owner,{id:randomUUID(),accepted:true,reason:'Fictional self review must be denied',legalApprovalReference:'Fictional reference without live permission'});assert.equal(self.status,403);
  await navigate(f.reviewer);await openPolicy();
  const reviewForm='details form:has(button[value="accept"])';
  await ui.fill(reviewForm+' [name="reason"]','Fictional independent source policy review for this bounded exercise.');
  await ui.fill(reviewForm+' [name="legalApprovalReference"]','FICTIONAL ONLY; no provider qualification or permission.');
  await ui.submit('Accept policy',reviewForm);await ui.textIncludes('Policy version 1 · approved');
  const approved=(await f.must<{items:ConnectorPolicyVersion[]}>(policy)).items[0]!;
  assert.equal(approved.review!.reviewerId,f.reviewer.userId);assert.equal(approved.proposedBy,f.owner.userId);
  await navigate(f.owner);const v1=await saveRequest(1);
  assert.equal(v1.authorId,f.owner.userId);assert.equal(v1.policyVersion,1);assert.equal(v1.authorityVersion,1);assert.match(v1.profileDigest,/^[a-f0-9]{64}$/);
  await ui.click('Inspect request history',saved);await ui.textIncludes(v1.digest,requestHistory);
  await navigate(f.collector);await ui.textIncludes('An assigned reviewer must authorise saved requests.');
  assert.equal(await b.evaluate(`!!document.querySelector(${JSON.stringify(requestForm)})`),false);
  const first=await queue();await supply();const captured=await successful(first,1,spec.adapter==='supplied_webpage_v1'?'supplied_webpage':'controlled_response');
  await ui.screenshot(artifacts,'capture-v1',detail);

  // Download through the actual UI, then run a copied independent helper outside the repository.
  await ui.click('Download internal research context',detail);
  const contextPath=join(downloads,'research-context-'+first+'.json');
  await eventually(async()=>{try{JSON.parse(await readFile(contextPath,'utf8'));return true;}catch{return false;}},'completed browser context download');
  const context=JSON.parse(await readFile(contextPath,'utf8'));
  assert.equal(context.payload.originalBase64,bytes.toString('base64'));assert.deepEqual(context.payload.receipt,captured.provenance!.payload.receipt);
  await cp(fileURLToPath(new URL('../../../tools/verify_research_context.py',import.meta.url)),join(downloads,'verify_research_context.py'));
  const verified=await promisify(execFile)('python3',['verify_research_context.py',contextPath],{cwd:downloads,timeout:10000,env:{...process.env,PYTHONPATH:'',PYTHONNOUSERSITE:'1'}});
  await writeFile(join(artifacts,'copied-verifier.json'),verified.stdout);await cp(contextPath,join(artifacts,'downloaded-context.json'));

  // This subtest intentionally exercises immediate navigation without a reload/workspace refresh.
  // A navigation failure must not prevent the remaining permission/history checks from running.
  await t.test('new captured original opens immediately, and supplied HTML stays inert',async()=>{
   await ui.click('Open captured original',runCss(first));
   try {
    await ui.textIncludes(captured.run.evidenceId!,'.evidence-inspector');
    await ui.textIncludes(spec.file,'.evidence-inspector');
    const preview=await ui.text('.evidence-inspector pre');assert.equal(preview,bytes.toString('utf8'));
    assert.equal(await b.evaluate('window.__fictionalResearchExecuted===undefined'),true);
    assert.deepEqual(f.traps,[]);assert.deepEqual(await b.evaluate(`performance.getEntriesByType('resource').map(e=>e.name).filter(x=>/^https?:/.test(x)&&!x.startsWith(${JSON.stringify(f.origin+'/')}))`),[]);
    assert.equal(await b.evaluate(`document.querySelectorAll('.evidence-inspector script,.evidence-inspector iframe,.evidence-inspector img').length`),0);
   }finally{await ui.screenshot(artifacts,'immediate-original','.evidence-inspector');}
  });

  await navigate(f.collector);await ui.click('Inspect run / supply original',runCss(first));
  const cancelled=await queue(first);
  await ui.fill(detail+' textarea[name="reason"]','Fictional explicit cancellation before supplied bytes.');await ui.click('Cancel run',detail);await ui.textIncludes('· cancelled',runCss(cancelled));
  assert.equal((await getRun(cancelled)).run.evidenceId,null);
  // Invalid UTF-8 fails through the same real API. Refresh exposes durable failure, never a fabricated receipt.
  const failed=await queue(first);await supply(invalid);await ui.textIncludes('valid UTF-8 only.','[role="alert"]');
  await ui.click('Refresh research requests');await ui.textIncludes('invalid_supplied_capture',runCss(failed));
  await ui.click('Inspect run / supply original',runCss(failed));await ui.textIncludes('· failed',detail);
  const failedDetail=await getRun(failed);assert.equal(failedDetail.run.status,'failed');assert.equal(failedDetail.run.evidenceId,null);assert.equal(failedDetail.provenance,null);
  await ui.screenshot(artifacts,'failed-capture',detail);

  await navigate(f.owner);const v2=await saveRequest(2);
  assert.equal(v2.requestId,v1.requestId);assert.notEqual(v2.id,v1.id);assert.notEqual(v2.digest,v1.digest);
  await ui.click('Inspect request history',saved);await ui.textIncludes(v1.digest,requestHistory);await ui.textIncludes(v2.digest,requestHistory);
  const history=await f.must<{versions:ResearchRequest[]}>(base+'/requests/'+v1.requestId);assert.deepEqual(history.versions.map(v=>v.version),[2,1]);assert.deepEqual(history.versions[1],v1);
  await navigate(f.collector);
  const count=(await state()).runs.length;await ui.click('Explicitly re-run same version',runCss(first));await ui.textIncludes('This run used a superseded request.','[role="alert"]');assert.equal((await state()).runs.length,count);
  const second=await queue();await supply(path,'fictional_fixture');const newer=await successful(second,2,spec.adapter==='supplied_webpage_v1'?'supplied_webpage':'fictional_fixture');
  assert.notEqual(newer.run.evidenceId,captured.run.evidenceId);assert.notEqual(newer.run.sourceId,captured.run.sourceId);
  assert.deepEqual((await getRun(first)).provenance,captured.provenance,'old source/capture lineage is immutable');
  await ui.click('Inspect request history',saved);await ui.textIncludes(v1.digest,requestHistory);await ui.textIncludes(v2.digest,requestHistory);await ui.screenshot(artifacts,'request-history',requestHistory);
  // The current request may explicitly retry its own completed run; it never silently retries on refresh.
  const retry=await queue(second);assert.equal((await getRun(retry)).run.requestVersion,2);
  await ui.fill(detail+' textarea[name="reason"]','Fictional explicit version-two retry cancellation.');await ui.click('Cancel run',detail);await ui.textIncludes('· cancelled',runCss(retry));

  // Only queue/cancel the explicitly labelled fixture job. No provider or fixture worker runs here.
  if(spec.adapter!=='supplied_webpage_v1'){
   const before=(await state()).runs.map(x=>x.id);
   await ui.click(spec.adapter==='gleif_lei_v1'?'Queue fictional LEI transport':'Queue fictional RDAP transport',saved);
   await ui.textIncludes('Provider collection stays disabled.',detail);
   const queued=(await state()).runs.filter(x=>!before.includes(x.id));assert.equal(queued.length,1);
   assert.equal(queued[0]!.executionMode,spec.adapter==='gleif_lei_v1'?'lei_transport':'rdap_transport');assert.equal(queued[0]!.status,'queued');assert.equal(queued[0]!.evidenceId,null);
   assert.equal(await b.evaluate(`!!document.querySelector(${JSON.stringify(captureForm)})`),false,'transport job has no supplied-file control');
   await ui.screenshot(artifacts,'fixture-job-awaiting-worker',detail);
   await ui.fill(detail+' textarea[name="reason"]','Fictional queue inspection only; do not execute a worker.');await ui.click('Cancel run',detail);await ui.textIncludes('· cancelled',runCss(queued[0]!.id));
  }

  // Refresh the independent source register explicitly; metadata/use gates remain separate.
  await ui.click('Refresh source register');
  await ui.wait(`!![...document.querySelectorAll('[aria-label="Supplied capture records"] button')].find(e=>e.textContent.includes(${JSON.stringify(publisher)})&&e.textContent.includes(${JSON.stringify(spec.file)}))`,'captured source register choice');
  const sourceLabels=await b.evaluate<string[]>(`[...document.querySelectorAll('[aria-label="Supplied capture records"] button')].filter(e=>e.textContent.includes(${JSON.stringify(publisher)})&&e.textContent.includes(${JSON.stringify(spec.file)})).map(e=>e.textContent.trim())`);
  assert.equal(sourceLabels.length,2,'each successful run registers a distinct source identity');
  await ui.click(sourceLabels[0]!,'[aria-label="Supplied capture records"]');
  await ui.textIncludes('Analysis blocked','[aria-label="Source-use decisions"]');
  await ui.textIncludes('Client release blocked','[aria-label="Source-use decisions"]');
  await ui.click('Verify linked original','[aria-label="Selected source record"]');await ui.textIncludes('Original bytes match the recorded digest.','[aria-label="Verified supplied original"]');await ui.textIncludes(hash(bytes),'[aria-label="Selected source record"]');
  await ui.click('Source context history','[aria-label="Selected source record"]');
  await ui.screenshot(artifacts,'source-record','[aria-label="Selected source record"]');

  const selectedSource=await b.evaluate<string>(`document.querySelector('[aria-label="Selected source record"]').id.replace('source-record-','')`);
  assert.ok([captured.run.sourceId,newer.run.sourceId].includes(selectedSource));
  const selectedOriginal=selectedSource===captured.run.sourceId?captured.run.evidenceId:newer.run.evidenceId;
  await t.test('source register navigates to the exact verified original identity',async()=>{
   await ui.click('Open supplied original','[aria-label="Verified supplied original"]');
   try {
    await ui.textIncludes(selectedOriginal!,'.evidence-inspector');assert.equal(await ui.text('.evidence-inspector pre'),bytes.toString('utf8'));
    assert.equal(await b.evaluate('window.__fictionalResearchExecuted===undefined'),true);assert.deepEqual(f.traps,[]);
   }finally{await ui.screenshot(artifacts,'source-original','.evidence-inspector');}
  });

  // Superseding policy immediately removes permission from the saved v2 request.
  await navigate(f.owner);await openPolicy();await proposePolicy(2);
  await ui.textIncludes('policy or authority changed',saved);
  assert.equal(await b.evaluate(`([...document.querySelectorAll(${JSON.stringify(saved+' button')})].find(e=>e.textContent.trim()==='Choose and queue supplied capture')).matches(':disabled')`),true);
  await ui.click('Inspect request history',saved);await ui.textIncludes(v1.digest,requestHistory);await ui.textIncludes(v2.digest,requestHistory);
  const frozen=(await getRun(first)).provenance;assert.deepEqual(frozen,captured.provenance);
  await ui.fill(saved+' textarea[name="reason"]','Fictional request withdrawal after historical capture.');await ui.click('Withdraw request permission',saved);await ui.textIncludes('Permission: withdrawn',saved);
  await ui.click('Inspect request history',saved);await ui.textIncludes('Fictional request withdrawal',requestHistory);
  await ui.screenshot(artifacts,'permission-history',requestHistory);

  // Case membership is removed through the real owner access API while this browser retains loaded data.
  await navigate(f.collector);await ui.click('Inspect request history',saved);await ui.click('Inspect run / supply original',runCss(first));await ui.textIncludes(hash(bytes),detail);
  await ui.click('Refresh source register');await ui.click(sourceLabels[0]!,'[aria-label="Supplied capture records"]');
  await ui.click('Verify linked original','[aria-label="Selected source record"]');await ui.textIncludes('Original bytes match the recorded digest.','[aria-label="Verified supplied original"]');
  await f.revokeCollector();await ui.click('Refresh research requests');
  await ui.wait(`!document.querySelector(${JSON.stringify(detail)})&&!document.querySelector(${JSON.stringify(requestHistory)})&&!document.querySelector('select[aria-label="Research source workflow"]')&&!document.querySelector('[aria-label="Selected source record"]')&&!document.querySelector('[aria-label="Verified supplied original"]')`,'revocation clears research controls, history and captured receipt');
  const after=await ui.text();for(const secret of [f.caseId,first,second,v1.digest,v2.digest,hash(bytes),publisher,title])assert.ok(!after.includes(secret),'revoked DOM retains '+secret);
  assert.equal((await f.call(base)).status,404);assert.equal((await f.call(base+'/runs/'+first)).status,404);assert.equal((await f.call(f.base+'/evidence/'+captured.run.evidenceId+'/original')).status,404);
  assert.deepEqual((await f.must<Detail>(base+'/runs/'+first,f.owner)).provenance,captured.provenance,'revocation preserves historical bytes and lineage for authorised readers');
  await ui.screenshot(artifacts,'revoked-access');
  const browserWrites=f.requests.filter(r=>r.method==='POST');
  for(const path of [policy,policy+'/1/review',base+'/requests',base+'/runs',base+'/runs/'+first+'/capture',base+'/runs/'+failed+'/capture',base+'/requests/'+v1.requestId+'/withdraw'])assert.ok(browserWrites.some(r=>r.path===path),'real browser POST '+path);
  assert.ok(browserWrites.some(r=>r.path===base+'/runs/'+failed+'/capture'&&r.status===422));
  assert.ok(!browserWrites.some(r=>r.path.includes('enable')));assert.deepEqual(f.traps,[]);
  await writeFile(join(artifacts,'browser-http-statuses.json'),JSON.stringify(f.requests,null,2));
 }catch(error){
  if(browser){const ui=researchControls(browser);await ui.screenshot(artifacts,'failure').catch(()=>{});await writeFile(join(artifacts,'failure-visible-text.txt'),await ui.text().catch(()=>'<document unavailable>'));}
  await writeFile(join(artifacts,'browser-http-statuses.json'),JSON.stringify(f.requests,null,2));throw error;
 }finally{try{await browser?.close();}finally{await f.close();}}
});
