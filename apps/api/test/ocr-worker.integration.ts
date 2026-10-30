import {forwardBrowserApi} from './support/browser-proxy.js';
/** Actual isolated OCR, PostgreSQL, browser and verifier acceptance; research workflow only. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createPool,runMigrations} from '../src/db.js';
import {createApp} from '../src/app.js';
import {encryptedOriginalStore} from '../src/original-encryption.js';
import {readOriginalBounded} from '../src/storage.js';
import {runOcrDocumentJob,runNativeDocumentJob,runRasterDocumentJob} from '../src/native-document-worker.js';
import {ocrKind,ocrExpandedKind} from '../src/ocr-derivative.js';
import {claimIntegrityJob,finishDocumentJob,runIntegrityJob} from '../src/integrity-jobs.js';
import {sha256} from '../src/text-derivative.js';
import {launchBrowser,eventually} from './support/browser.js';

const root=fileURLToPath(new URL('../../../',import.meta.url)),origin='http://localhost:5173';
const tenant='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminUrl);assert.match(database,/\/inveos_test$/);assert.match(adminUrl,/\/inveos_test$/);
 const schema='ocr_test_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,'public',2);await runMigrations(admin,schema);
 const pool=createPool(database,schema,6),owner=createPool(adminUrl,schema,2),storage=await mkdtemp('/tmp/inveos-ocr-originals-');
 const key=randomBytes(32),store=encryptedOriginalStore(join(storage,'objects'),'supplier-fictional',{['supplier-fictional']:key});
 let browserOrigin:string|undefined;
 const make=()=>createApp({pool,storageRoot:encryptedOriginalStore(join(storage,'objects'),'supplier-fictional',{['supplier-fictional']:key}),allowedOrigins:[origin,...(browserOrigin?[browserOrigin]:[])],demoTenantId:tenant,demoUserId:user,sessionTtlSeconds:3600,documentLab:true});let app=await make();await app.ready();
 const started=await app.inject({method:'POST',url:'/api/session/start',headers:{origin},payload:{}});assert.equal(started.statusCode,200,started.body);const cookies=started.headers['set-cookie'];
 const demo={cookie:(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(c=>c!.split(';')[0]).join('; '),csrf:started.json().csrf};
 const request=(method:'GET'|'POST',url:string,payload?:object,session=demo)=>app.inject({method,url,headers:{cookie:session.cookie,origin,'x-csrf-token':session.csrf},...(payload?{payload}:{})});
 const ok=async(method:'GET'|'POST',url:string,payload?:object,session=demo)=>{const r=await request(method,url,payload,session);assert.equal(r.statusCode,200,r.body);return r.json();};
 const kase=await ok('POST','/api/cases',{title:'SYN-SUPPLIER-001 fictional digital and scanned comparison',client:'Fictional Northstar client',scope:'Supplied fictional supplier records only',jurisdiction:'England and Wales'}),caseId=kase.id;
 await ok('POST',`/api/cases/${caseId}/authority`,{purpose:'Fictional supplier investigation acceptance',lawfulBasis:'Synthetic no-personal-data exercise',scope:'Supplied fictional supplier records only',retentionDays:30,minimisation:'Fictional records and test sessions only'});
 async function member(role:'reviewer'|'investigator'|'client',assigned=true,memberTenant=tenant){const id=randomUUID();await owner.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[id,'Fictional OCR '+role]);await owner.query('INSERT INTO memberships VALUES($1,$2,$3)',[memberTenant,id,role]);if(assigned)await owner.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[memberTenant,caseId,id]);const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await owner.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[sha256(token),randomUUID(),sha256(csrf),memberTenant,id]);return {id,cookie:`inveos_session=${token}; inveos_csrf=${csrf}`,csrf};}
 async function queue(bytes:Buffer,kind:string){const native=kind==='native_pdf_lab_v1';const evidence=await ok('POST',`/api/cases/${caseId}/evidence/binary`,{filename:native?'fictional-declaration.pdf':'fictional-scanned-register.pdf',contentBase64:bytes.toString('base64'),expectedSha256:sha256(bytes),sourceTime:native?'2026-10-25T00:00:00Z':'2026-09-01T00:00:00Z',method:'Supplied first-party fictional record; sourceTime is fixture record date, not ingest or scan time',idempotencyKey:randomUUID()});const job=await ok('POST',`/api/cases/${caseId}/integrity-jobs`,{evidenceId:evidence.id,idempotencyKey:randomUUID(),kind});return {scope:{tenantId:tenant,caseId,jobId:job.id},evidence,job};}
 return {pool,owner,storage,store,caseId,demo,request,ok,member,queue,get app(){return app;},restart:async(extraOrigin?:string)=>{await app.close();browserOrigin=extraOrigin;app=await make();await app.ready();},close:async()=>{await app.close();await pool.end();await owner.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(storage,{recursive:true,force:true});key.fill(0);}};
}

async function inspectInBrowser(f:Awaited<ReturnType<typeof fixture>>,jobId:string,rasterJobId:string,profileVersion:number,sourceId:string){
 const dist=join(root,'apps/web/dist');let api='';const upstreams=new Set<ReturnType<typeof forwardBrowserApi>>();
 const server=createServer((req,res)=>{void(async()=>{const path=new URL(req.url!,'http://localhost').pathname;
  if(path.startsWith('/api/')){const upstream=forwardBrowserApi(req,res,api+req.url);upstreams.add(upstream);upstream.once('close',()=>upstreams.delete(upstream));return;}
  if(path==='/'){res.setHeader('content-type','text/html');res.end(await readFile(join(dist,'index.html')));return;}
  if(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path)){res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(dist,path.slice(1))));return;}res.statusCode=404;res.end();})().catch(()=>{res.statusCode=500;res.end();});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(server.address() as {port:number}).port;let b:Awaited<ReturnType<typeof launchBrowser>>|undefined;
 await f.restart(url);api=await f.app.listen({host:'127.0.0.1',port:0});
 try{b=await launchBrowser();const browser=b;await b.send('Network.enable');await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for(const pair of f.demo.cookie.split('; ')){const at=pair.indexOf('=');await b.send('Network.setCookie',{name:pair.slice(0,at),value:pair.slice(at+1),url,path:'/',sameSite:'Strict',httpOnly:pair.startsWith('inveos_session=')});}
  // Navigation and reload can expose the new document before its body exists.
  const text=()=>browser.evaluate<string>("document.body?.innerText ?? ''"),label='Inspect unreviewed pages '+jobId.slice(0,8);
  await b.send('Page.navigate',{url:url+'/#case='+f.caseId+'&view=Evidence'});await eventually(async()=>(await text()).includes(label),'actual OCR durable browser job');
  const click=()=>browser.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('OCR inspection unavailable');button.click();})()`);
  await click();await eventually(async()=>(await text()).includes('Unreviewed OCR words'),'actual OCR browser inspection');assert.ok((await text()).includes('OCR may misread words'));assert.ok((await text()).includes('origin TOPLEFT'));
  const previousOrigin=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await browser.evaluate<number>('performance.timeOrigin')!==previousOrigin,'new browser document after OCR reload');await eventually(async()=>(await text()).includes(label),'OCR job restored after browser reload');await click();await eventually(async()=>(await text()).includes('Unreviewed OCR words'),'OCR reinspection after reload');
  const compare='Compare image '+rasterJobId.slice(0,8)+' with passages '+jobId.slice(0,8);await eventually(async()=>(await text()).includes(compare),'same-evidence OCR/image pairing');
  await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(compare)});if(!button||button.disabled)throw new Error('OCR comparison unavailable');button.click();})()`);
  await eventually(async()=>await browser.evaluate<boolean>(`(()=>{const img=document.querySelector('img[alt="Unreviewed rendered page 1"]');return !!img&&img.complete&&img.naturalWidth===612&&img.naturalHeight===792;})()`),'actual original-page raster decoded beside OCR');
  assert.ok(await b.evaluate<number>(`document.querySelectorAll('svg[aria-label="Passage overlay for page 1"] rect').length`)>0);
  await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Compare page 1 passage 1');if(!button)throw new Error('OCR region unavailable');button.click();})()`);await eventually(async()=>(await text()).includes('Selected #/texts/0'),'OCR region comparison selection');
  assert.ok(await b.evaluate<boolean>(`document.querySelector('.evidence-inspector .panel-heading')?.textContent.includes(${JSON.stringify(sourceId)})===true`),'vault selection agrees with the verified extraction original');
  if(profileVersion===2){
   await b.evaluate(`document.querySelector('[aria-label="Verified unreviewed raster pages"]').scrollIntoView({block:'start'})`);
   const clip=await b.evaluate<{x:number;y:number;width:number;height:number;scale:number}>(`(()=>{const r=document.querySelector('[aria-label="Verified unreviewed raster pages"]').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1};})()`);
   assert.ok(clip.width>0&&clip.height>0&&clip.height<4000);
   await mkdir(join(root,'output/evals'),{recursive:true});const shot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});await writeFile(join(root,'output/evals/ocr-expanded-comparison.png'),Buffer.from(shot.data,'base64'));
  }
  await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Brief'&&b.getClientRects().length);button.click();})()`);
  await eventually(async()=>await browser.evaluate<boolean>(`!!document.querySelector('input[name="caseQuery"]')`),'supplier case search');
  await b.evaluate(`(()=>{const input=document.querySelector('input[name="caseQuery"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'60');input.dispatchEvent(new Event('input',{bubbles:true}));const select=document.querySelector('select[name="caseKind"]');select.value='document_text';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Search case records');button.click();})()`);
  await eventually(async()=>{const error=await browser.evaluate<string>(`document.querySelector('form[aria-label="Case record search"]')?.parentElement.querySelector('.form-error')?.textContent||''`);if(error)throw new Error('Actual OCR browser search: '+error);return await browser.evaluate<boolean>(`[...document.querySelectorAll('[aria-label="Case search results"] article')].some(article=>article.textContent.includes(${JSON.stringify(jobId)}))`);},'actual OCR searchable result');
  await b.evaluate(`(()=>{const article=[...document.querySelectorAll('[aria-label="Case search results"] article')].find(article=>article.textContent.includes(${JSON.stringify(jobId)}));[...article.querySelectorAll('button')].find(button=>button.textContent==='Verify and inspect extraction').click();})()`);
  await eventually(async()=>await browser.evaluate<boolean>(`document.querySelector('[aria-label="Verified unreviewed document derivative"]')?.textContent.includes(${JSON.stringify(jobId)})===true`),'actual searched OCR reverified');
 }finally{try{await b?.close();}finally{server.closeAllConnections();for(const upstream of upstreams)upstream.destroy();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}}
}

function expandedScan(original:Buffer){
 const marker=original.lastIndexOf(Buffer.from('\nxref\n'))+1;assert.ok(marker>0);
 const padding=Buffer.from(('% Fictional non-evidential padding '+'.'.repeat(48)+'\n').repeat(1024));
 const tail=original.subarray(marker).toString('latin1');assert.ok(tail.includes('startxref\n'+marker+'\n'));
 const enlarged=Buffer.concat([original.subarray(0,marker),padding,Buffer.from(tail.replace('startxref\n'+marker+'\n','startxref\n'+(marker+padding.length)+'\n'),'latin1')]);
 assert.ok(enlarged.length>65536&&enlarged.length<=262144);return enlarged;
}
for(const profileVersion of [1,2])test('actual isolated supplier profile '+profileVersion+' originals progress through OCR, independent review, frozen exhibits/PDF and approved restricted delivery',{timeout:270000},async t=>{
 const processingKind=profileVersion===1?ocrKind:ocrExpandedKind,rasterKind=profileVersion===1?'pdf_raster_lab_v1':'pdf_raster_lab_v2';
 const f=await fixture();try{
  const qualification=JSON.parse(await readFile(join(root,'.research-cache/tesseract-worker-qualification.json'),'utf8')),nativeQualification=JSON.parse(await readFile(join(root,'.research-cache/worker-qualification.json'),'utf8'));
  const input=JSON.parse(await readFile(join(root,'.research-cache/tesseract-supplier-input.json'),'utf8')),originalScan=Buffer.from(input.scannedRegisterPdfBase64,'base64'),scan=profileVersion===1?originalScan:expandedScan(originalScan),digital=Buffer.from(input.declarationPdfBase64,'base64');
  assert.notEqual(sha256(scan),sha256(digital));assert.ok(digital.includes(Buffer.from('100 PERCENT')));assert.equal(digital.includes(Buffer.from('60 PERCENT')),false);assert.equal(scan.includes(Buffer.from('/Font')),false);
  const author=await f.member('investigator'),independent=await f.member('reviewer'),client=await f.member('client',false),outsider=await f.member('reviewer',false);
  const jobs=[];let previous:unknown;
  for(let attempt=0;attempt<2;attempt++){
   const job=await f.queue(scan,processingKind);assert.equal(await runNativeDocumentJob(f.pool,f.store,job.scope,{researchOnly:true,repositoryRoot:root,qualification:nativeQualification}),null);
   const result=await runOcrDocumentJob(f.pool,f.store,job.scope,{researchOnly:true,repositoryRoot:root,qualification});assert.equal(result?.status,'succeeded',JSON.stringify(result));
   const d=await f.ok('GET',`/api/cases/${f.caseId}/integrity-jobs/${job.job.id}/document-derivative`);assert.equal(d.derivative.coverage.completeExtractionVerified,false);assert.equal(d.derivative.offsetBasis,'ocr_utf8_not_original_pdf');
   const stable={source:d.sourceDigest,text:d.derivative.text,references:d.derivative.references,pages:d.derivative.pages,artifacts:d.derivative.ocr.artifacts};if(previous)assert.deepEqual(stable,previous);previous=stable;
   assert.equal((await f.pool.query('SELECT status FROM evidence WHERE id=$1',[job.evidence.id])).rows[0].status,'Quarantined');jobs.push({...job,d});
  }
  if(profileVersion===2)for(const legacy of [ocrKind,'pdf_raster_lab_v1'])assert.equal((await f.request('POST',`/api/cases/${f.caseId}/integrity-jobs`,{evidenceId:jobs[0]!.evidence.id,idempotencyKey:randomUUID(),kind:legacy})).statusCode,409,'Larger originals cannot silently use historical profiles');
  const ocr=jobs[0]!,digitalJob=await f.queue(digital,'native_pdf_lab_v1');assert.equal((await runNativeDocumentJob(f.pool,f.store,digitalJob.scope,{researchOnly:true,repositoryRoot:root,qualification:nativeQualification}))?.status,'succeeded');const native=await f.ok('GET',`/api/cases/${f.caseId}/integrity-jobs/${digitalJob.job.id}/document-derivative`);
  const search=await f.ok('POST',`/api/cases/${f.caseId}/search`,{query:'60',kind:'document_text',status:''});
  assert.deepEqual(search.items.map((hit:{id:string})=>hit.id).sort(),jobs.map(job=>job.job.id).sort());assert.ok(search.items.every((hit:{status:string})=>hit.status==='Unreviewed OCR text'));
  const nativeSearch=await f.ok('POST',`/api/cases/${f.caseId}/search`,{query:'100',kind:'document_text',status:''});assert.equal(nativeSearch.items.length,1);assert.equal(nativeSearch.items[0].id,digitalJob.job.id);assert.equal(nativeSearch.items[0].status,'Unreviewed extracted text');
  assert.equal((await f.request('POST',`/api/cases/${f.caseId}/search`,{query:'60',kind:'document_text',status:''},client)).statusCode,403);
  const rasterJob=await f.ok('POST',`/api/cases/${f.caseId}/integrity-jobs`,{evidenceId:ocr.evidence.id,idempotencyKey:randomUUID(),kind:rasterKind});assert.equal((await runRasterDocumentJob(f.pool,f.store,{tenantId:tenant,caseId:f.caseId,jobId:rasterJob.id},{researchOnly:true,repositoryRoot:root,qualification:nativeQualification}))?.status,'succeeded');
  assert.equal((await f.request('GET',`/api/cases/${f.caseId}/integrity-jobs/${ocr.job.id}/document-derivative`,undefined,outsider)).statusCode,404);
  const foreignTenant=randomUUID();await f.owner.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[foreignTenant,'Fictional isolated OCR tenant']);const foreign=await f.member('reviewer',false,foreignTenant);assert.equal((await f.request('GET',`/api/cases/${f.caseId}/integrity-jobs/${ocr.job.id}/document-derivative`,undefined,foreign)).statusCode,404);assert.equal(await runOcrDocumentJob(f.pool,f.store,{...ocr.scope,tenantId:foreignTenant},{researchOnly:true,repositoryRoot:root,qualification}),null);
  const reviewedFindingIds:string[]=[];
  for(const [entry,number,narrative] of [[ocr,'60','The fictional scanned register dated 1 September records Atlas at 60 percent and Birch at 40 percent. This differs from the later declaration. A later ownership change, stale record or transcription error remains an alternative explanation; the documents alone do not establish wrongdoing.'],[{...digitalJob,d:native},'100','The fictional declaration dated 25 October records Atlas at 100 percent. It is later than the supplied register; its completeness and the reason for the difference require further authorised corroboration.']] as const){
   const d=entry.d.derivative,bytes=Buffer.from(d.text),ref=d.references.find((r:{startByte:number;endByte:number})=>bytes.subarray(r.startByte,r.endByte).toString().includes(number));assert.ok(ref);
   const quote=bytes.subarray(ref.startByte,ref.endByte).toString(),base=`/api/cases/${f.caseId}/integrity-jobs/${entry.job.id}/document-citations/${randomUUID()}`;
   const candidate=await f.ok('POST',base,{derivativeDigest:entry.d.derivativeDigest,itemRef:ref.itemRef,startByte:ref.startByte,endByte:ref.endByte,quote},author);
   const reviewInput={id:randomUUID(),previousReviewId:null,citationDigest:candidate.citationDigest,decision:'accepted',reason:'Fictional scripted reviewer compared exact page region with the supplied original; this tests the workflow, not a professional sign-off.',originalCompared:true};
   assert.equal((await f.request('POST',base+'/reviews',reviewInput,author)).statusCode,403);const review=(await f.ok('POST',base+'/reviews',reviewInput)).reviews[0];
   const claim=(await f.ok('POST',base+'/claims',{id:randomUUID(),citationDigest:candidate.citationDigest,correspondenceReviewId:review.id,correspondenceReviewDigest:review.digest,text:narrative},author)).claims[0];
   const decision={id:randomUUID(),claimDigest:claim.digest,accepted:true,reason:'Fictional independent interpretation preserves both the discrepancy and alternative explanations without inferring wrongdoing.'};await f.ok('POST',base+'/claims/'+claim.id+'/decision',decision);reviewedFindingIds.push(decision.id);
  }
  const workBase=`/api/cases/${f.caseId}/work`;
  const question=await f.ok('POST',workBase,{id:randomUUID(),kind:'question',title:'Do the supplied fictional ownership records agree?',body:'Compare source assertions; explain uncertainty without inferring wrongdoing.',ownerId:author.id,dueDate:null,parentId:null});
  const alternatives=[];
  for(const title of ['Ownership may have changed between the record dates','One supplied record may be stale or contain a transcription error'])alternatives.push(await f.ok('POST',workBase,{id:randomUUID(),kind:'hypothesis',title,body:'Working explanation only. A dated transfer record or corrected register is not supplied.',ownerId:author.id,dueDate:null,parentId:question.id}));
  for(const [index,id] of reviewedFindingIds.entries()){
   await f.ok('POST',`${workBase}/${question.id}/document-links`,{id:randomUUID(),findingId:id,relation:index===0?'contradicts':'supports',reason:'Compare the supplied declaration with the older register; dates and assertions differ.'});
   for(const hypothesis of alternatives)await f.ok('POST',`${workBase}/${hypothesis.id}/document-links`,{id:randomUUID(),findingId:id,relation:'context',reason:'The date and statement difference motivate this possible explanation; neither source proves it.'});
  }
  const closure={expectedVersion:question.version,title:question.title,body:question.body,ownerId:question.ownerId,dueDate:null,status:'Resolved',reason:'The supplied assertions differ (60 and 100 percent) at different dates. Both explanations remain proposed; no actual ownership or wrongdoing conclusion. Further corroboration is outside this fictional supplied-record scope.'};
  await f.ok('POST',`${workBase}/${question.id}/revise`,closure);
  const history=await f.ok('GET',`${workBase}/${question.id}/history`);assert.equal(history[0].sources.length,6);assert.deepEqual(history[1].sources,[]);
  const candidate=await f.ok('GET',workBase+'/document-findings/'+reviewedFindingIds[0]);assert.equal(candidate.reference.offsetBasis,'ocr_utf8_not_original_pdf');
  await inspectInBrowser(f,ocr.job.id,rasterJob.id,profileVersion,ocr.evidence.id);await f.restart();
  const base=`/api/cases/${f.caseId}/report-revisions`,freeze={idempotencyKey:randomUUID()},revision=await f.ok('POST',base,freeze);assert.deepEqual(await f.ok('POST',base,freeze),revision);
  const exported=await f.request('GET',`${base}/${revision.id}/document-package`);assert.equal(exported.statusCode,200,exported.body);const packagePath=join(f.storage,'fictional-supplier-package.json');await writeFile(packagePath,exported.rawPayload);
  const verify=spawnSync('python3',[join(root,'tools/verify_document_package.py'),packagePath,'--expected-report-sha256',revision.sha256,'--expected-package-sha256',sha256(exported.rawPayload)],{encoding:'utf8',timeout:10000});assert.equal(verify.status,0,verify.stderr);assert.equal(JSON.parse(verify.stdout).documentFindingsChecked,2);assert.equal(JSON.parse(verify.stdout).documentWorkLinksChecked,6);
  const rendition=await f.ok('POST',`${base}/${revision.id}/renditions`,{idempotencyKey:randomUUID(),redactedFindingIds:[],reason:''});const pdfBase=`${base}/${revision.id}/renditions/${rendition.id}`;
  const pdf=await f.request('GET',pdfBase);assert.equal(pdf.statusCode,200,pdf.body);const pdfPath=join(f.storage,'fictional-supplier-report.pdf');await writeFile(pdfPath,pdf.rawPayload);const pdfCheck=spawnSync('python3',[join(root,'tools/verify_report_pdf.py'),pdfPath,'--expected-pdf-sha256',rendition.pdfSha256,'--expected-report-sha256',revision.sha256],{encoding:'utf8',timeout:10000});assert.equal(pdfCheck.status,0,pdfCheck.stderr);
  const release={pdfSha256:rendition.pdfSha256,recipientId:client.id,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'Fictional explicit approval of this exact reviewed PDF for one restricted test recipient.',confirmReviewedDisclosure:true};assert.equal((await f.request('POST',pdfBase+'/disclosures',release)).statusCode,409);
  await f.ok('POST',pdfBase+'/reviews',{pdfSha256:rendition.pdfSha256,redactionSha256:rendition.redactionSha256,decision:'accept_for_disclosure',reason:'Fictional scripted independent reviewer inspected the exact report and retained alternative explanations.',confirmInspected:true},independent);
  const grant=await f.ok('POST',pdfBase+'/disclosures',release);assert.deepEqual(await f.ok('POST',pdfBase+'/disclosures',release),grant);const portal='/api/portal/disclosures/'+grant.id;
  assert.equal((await f.request('GET',portal,undefined,author)).statusCode,403);assert.equal((await f.request('GET',`/api/cases/${f.caseId}/integrity-jobs/${ocr.job.id}/document-derivative`,undefined,client)).statusCode,403);
  assert.deepEqual((await f.request('GET',portal,undefined,client)).rawPayload,pdf.rawPayload);await f.ok('POST',portal+'/acknowledge',{sha256:rendition.pdfSha256,confirmReceipt:true},client);
  await f.restart();assert.deepEqual((await f.request('GET',portal,undefined,client)).rawPayload,pdf.rawPayload);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM document_findings WHERE case_id=$1',[f.caseId])).rows[0].n,2);
  await assert.rejects(f.owner.query('DELETE FROM document_derivatives WHERE job_id=$1',[ocr.job.id]),/append.only|immutable/i);
  const malformed=await f.queue(Buffer.from('%PDF-1.4\nFICTIONAL malformed\n'),processingKind);assert.equal((await runOcrDocumentJob(f.pool,f.store,malformed.scope,{researchOnly:true,repositoryRoot:root,qualification}))?.status,'failed');assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM document_derivatives WHERE job_id=$1',[malformed.job.id])).rows[0].n,0);
  const cancelled=await f.queue(scan,processingKind);assert.equal(await runIntegrityJob(f.pool,f.store,cancelled.scope),null);await assert.rejects(runOcrDocumentJob(f.pool,f.store,cancelled.scope,{researchOnly:true,repositoryRoot:root,qualification:{...qualification,artifactLock:'f'.repeat(64)}}));const lease=await claimIntegrityJob(f.pool,cancelled.scope);assert.ok(lease);await f.ok('POST',`/api/cases/${f.caseId}/integrity-jobs/${cancelled.job.id}/cancel`,{});
  const saved=(await f.pool.query('SELECT raw_bytes FROM document_derivatives WHERE job_id=$1',[ocr.job.id])).rows[0];const context={...cancelled.scope,evidenceId:cancelled.evidence.id,sourceDigest:sha256(scan),authorityVersion:cancelled.job.authorityVersion};assert.equal(await finishDocumentJob(f.pool,f.store,cancelled.scope,lease.token,{context,profileDigest:ocr.d.profileDigest,successful:true,raw:saved.raw_bytes}),null);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM document_derivatives WHERE job_id=$1',[cancelled.job.id])).rows[0].n,0);
  await f.ok('POST',`/api/cases/${f.caseId}/disclosures/${grant.id}/revoke`,{reason:'Fictional explicit withdrawal after scripted recipient acknowledgement.'});assert.equal((await f.request('GET',portal,undefined,client)).statusCode,404);
  assert.deepEqual((await readdir(join(root,'.research-cache'))).filter(n=>n.startsWith('leased-document-')),[]);
  const stored=(await f.pool.query('SELECT object_path FROM evidence WHERE id=$1',[ocr.evidence.id])).rows[0];assert.match(stored.object_path,/\.bin\.enc$/);const sealed=await readFile(join(f.store.rootPath,stored.object_path));assert.equal(sealed.includes(scan),false);assert.deepEqual(await readOriginalBounded(f.store,stored.object_path,profileVersion===1?65536:262144),scan);
  t.diagnostic('Actual isolated supplier acceptance: '+JSON.stringify({profileVersion,originalBytes:scan.length,encryptedOriginals:true,scanSha256:sha256(scan),digitalSha256:sha256(digital),ocrRawDigest:ocr.d.rawDigest,ocrDerivativeDigest:ocr.d.derivativeDigest,ocrWords:ocr.d.derivative.references.length,documentFindings:2,documentWorkLinks:6,competingHypothesesRemainProposed:true,questionClosureHistory:true,independentPackageVerified:true,independentPdfVerified:true,browserOcrReload:true,browserStoredExtractionSearch:true,browserOriginalPageComparison:true,restrictedPdfDelivery:true,acknowledgementAndRevocation:true,cancelledAttachmentDenied:true,realProfessionalReview:false}));
 }finally{await f.close();}
});
