/** Explicit sandboxed browser acceptance. No skip, mock, auto-release or sandbox fallback.
 * Build apps/web first; root runs this file on the hosted real PostgreSQL/browser runner. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {CompositionRevision,ReportDraft,TaskTemplateRevision,TaskTemplatePreview,TaskTemplateApplication} from '@inveos/contracts';
import {compositionTemplateBrowser} from './support/composition-template-browser.js';
import {sha,tenant} from './support/workflow-fixture.js';

const exec=promisify(execFile),composition='.report-composition',templates='.task-templates';
const scopeNote='Fictional outline scope marker: only the selected supplied notes were considered.';
const methodNote='Fictional manual source comparison; no automated factual conclusion.';
const limitationNote='Fictional attributed accounts only; completeness and truth remain unestablished.';
const alpha='Fictional ALPHA-OMIT dispatch note GBP 100.';
const beta='Fictional BETA-KEEP dispatch note GBP 200.';
const unselected='Fictional GAMMA-UNSELECTED dispatch note GBP 300.';

test('sandboxed composition browser: author/correct/review/freeze, whole-finding copies and denied-data clearing',{timeout:180000},async()=>{
  const h=await compositionTemplateBrowser(),{f,browser}=h;
  const name='Fictional browser saved composition';
  try{
    await f.finding(alpha);await f.finding(beta);await f.finding(unselected);
    await h.navigate(f.investigator.headers,'Reports');await h.button('New outline',composition);
    await h.fill('Outline name',name,composition);
    for(const [label,text] of [['scope',scopeNote],['method',methodNote],['limitations',limitationNote]])await h.fill('Declared '+label,text!,composition);
    await h.fill('Section 1 label','Fictional first section',composition);await h.button('Load verified finding choices',composition);
    await h.wait(`document.querySelector(${JSON.stringify(composition)}).textContent.includes(${JSON.stringify(unselected)})`,'three verified choices');
    const choice=(text:string)=>`[...document.querySelectorAll('.report-composition form li')].find(e=>e.textContent.includes(${JSON.stringify(text)}))?.querySelector('button')`;
    await h.click(choice(alpha));await h.fill('Reason for this version','Fictional initial selection of the alpha attributed statement.',composition);await h.button('Save outline version',composition);
    await h.wait(`!!document.querySelector('[aria-label="Saved outline detail"]')`,'saved version one');
    const first=(await f.must<{items:CompositionRevision[]}>(f.base+'/report-compositions')).items[0]!;
    assert.equal(first.payload.version,1);assert.equal(first.authorId,f.investigator.id);assert.equal(first.review,null);
    assert.equal(await browser.evaluate(`!!document.querySelector('.report-composition button')&&[...document.querySelectorAll('.report-composition button')].some(b=>b.textContent==='Accept exact outline')`),false,'author has no self-accept control');
    async function review(version:number){
      await h.navigate(f.reviewer.headers,'Reports');await h.button(name,'.composition-register',true);
      await h.wait(`document.querySelector('[aria-label="Saved outline detail"]')?.textContent.includes(${JSON.stringify(name+' · v'+version)})`,'review exact version');
      await h.fill('Decision / withdrawal reason','Fictional independent inspection of exact selection and context.',composition);
      await h.check('I inspected this version.',composition);await h.button('Accept exact outline',composition);
      await h.wait(`document.querySelector('[aria-label="Saved outline detail"]')?.textContent.includes('Review: accepted')`,'saved independent composition acceptance');
    }
    await review(1);
    await h.navigate(f.investigator.headers,'Reports');await h.button(name,'.composition-register',true);await h.button('Revise outline',composition);
    await h.fill('Declared scope',scopeNote+' Corrected to include beta.',composition);
    await h.button('Add named section',composition);await h.fill('Section 2 label','Fictional beta section first',composition);
    await h.button('Load verified finding choices',composition);
    const sectionId=await browser.evaluate<string>(`document.querySelectorAll('.report-composition form .composition-section input')[1].closest('section').querySelector('input').value`);
    assert.equal(sectionId,'Fictional beta section first');
    // The destination options carry generated stable section UUIDs; choose the saved option explicitly.
    const destination=await browser.evaluate<string>(`(${h.control('Destination section',composition)}).options[1].value`);
    await h.select('Destination section',destination,composition);await h.click(choice(beta));
    await h.button('Move section up','.report-composition form .composition-section:nth-of-type(2)');
    await h.fill('Reason for this version','Fictional correction selects beta first and preserves alpha second.',composition);await h.button('Save outline version',composition);
    await h.wait(`document.querySelector('[aria-label="Saved outline detail"]')?.textContent.includes(${JSON.stringify(name+' · v2')})`,'corrected version two');
    const corrected=await f.must<CompositionRevision>(f.base+'/report-compositions/'+first.payload.id);
    assert.equal(corrected.review,null,'new version cannot inherit acceptance');
    assert.ok(await browser.evaluate<boolean>(`(${h.textElement('button','Freeze accepted composition',composition)}).matches(':disabled')`));
    await h.button('Revision history',composition);await h.wait(`document.querySelector('[aria-label="Composition revision history"]')?.querySelectorAll('details').length===2`,'immutable two-version history');
    await review(2);
    await h.navigate(f.investigator.headers,'Reports');await h.button(name,'.composition-register',true);
    await h.button('Inspect selected source receipts',composition);await h.wait(`document.querySelector('[aria-label="Selected finding receipts"]')?.querySelectorAll('details').length===2`,'exact selection receipts');
    const previewText=await h.text('[aria-label="Selected finding receipts"]');assert.ok(previewText.includes(alpha)&&previewText.includes(beta));assert.ok(!previewText.includes(unselected));
    await h.captures('composition-selected-reviewed','[aria-label="Selected finding receipts"]');
    await h.check('I inspected this version.',composition);await h.button('Freeze accepted composition',composition);
    await h.wait(`document.querySelector('.report-composition')?.textContent.includes('Composed internal revision frozen.')`,'composed report frozen through UI');
    const receipt=(await f.must<{items:{id:string;sha256:string}[]}>(f.base+'/report-revisions')).items[0]!;
    const path=f.base+'/report-revisions/'+receipt.id,download=await f.call(path),report=download.json<ReportDraft>();
    assert.equal(sha(download.rawPayload),receipt.sha256);assert.equal(report.composition!.payload.version,2);
    assert.deepEqual(report.composition!.payload.outline,corrected.payload.outline);
    assert.equal(report.composition!.review.reviewerId,f.reviewer.id);
    assert.deepEqual(report.findings.map(x=>x.text).sort(),[alpha,beta].map(text=>'The fictional supplied record states: '+text).sort());
    const omitted=report.findings.find(x=>x.source.quote===alpha)!,kept=report.findings.find(x=>x.source.quote===beta)!;
    assert.ok(omitted&&kept,'exact supplied quotations identify both selected findings');
    assert.deepEqual(report.composition!.payload.outline.sections.flatMap(s=>s.findings.map(x=>x.id)),[kept.id,omitted.id]);
    const row='#report-revision-'+receipt.id;
    for(const format of ['pdf','docx'] as const){
      const summary=format==='pdf'?'Create an internal redacted PDF':'Editable DOCX copies';
      await h.click(h.textElement('summary',summary,row));
      // Scope to the open details owning this exact format, even if both redaction editors are open.
      // Discover by its summary rather than relying on sibling positions in the product.
      await browser.evaluate(`(${h.textElement('summary',summary,row)}).parentElement.setAttribute('data-journey-format',${JSON.stringify(format)})`);
      const pane=`${row} [data-journey-format="${format}"]`;
      await h.button('Load frozen findings',pane);await h.wait(`document.querySelector(${JSON.stringify(pane)})?.textContent.includes(${JSON.stringify(alpha)})`,'loaded exact frozen redaction candidates');
      await h.click(`[...document.querySelectorAll(${JSON.stringify(pane+' article.work-record')})].find(e=>e.textContent.includes(${JSON.stringify(alpha)}))?.querySelector('input[type="checkbox"]')`);
      await h.fill(format==='pdf'?'Redaction reason':'DOCX redaction reason','Fictional controlled whole-finding omission of selected alpha.',pane);
      if(format==='pdf')await h.check('I understand this omits whole findings only',pane);
      await h.button(format==='pdf'?'Create redacted PDF':'Create redacted DOCX',pane);
      await h.wait(`document.body.textContent.includes(${JSON.stringify(format==='pdf'?'Redacted PDF bytes verified and downloaded.':'Exact editable copy verified and downloaded.')})`,'UI verified '+format+' copy');
      const route=format==='pdf'?'renditions':'editable-renditions';
      const saved=(await f.must<{items:{id:string;pdfSha256?:string;docxSha256?:string;redactedFindingCount:number}[]}>(path+'/'+route)).items[0]!;
      assert.equal(saved.redactedFindingCount,1);
      const bytes=(await f.call(path+'/'+route+'/'+saved.id)).rawPayload;
      assert.equal(sha(bytes),format==='pdf'?saved.pdfSha256:saved.docxSha256);
      const file=join(h.artifacts,'composition-redacted.'+format);await writeFile(file,bytes);
      let model:string,visible:string;
      if(format==='pdf'){
        const raw=bytes.toString('ascii'),encoded=/\/Filter \/ASCIIHexDecode >>\nstream\n([A-F0-9]+)>/.exec(raw);assert.ok(encoded);
        model=Buffer.from(encoded[1]!,'hex').toString('utf8');
        visible=[...raw.matchAll(/<([A-F0-9]*)> Tj T\*/g)].map(m=>Buffer.from(m[1]!,'hex').toString('latin1')).join('\n');
      }else{
        const result=await exec('python3',['-c','import zipfile,sys,json,base64,xml.etree.ElementTree as E\nz=zipfile.ZipFile(sys.argv[1]); print(json.dumps([base64.b64decode(E.fromstring(z.read("customXml/item1.xml")).text).decode(),z.read("word/document.xml").decode()]))',file]);
        [model,visible]=JSON.parse(result.stdout) as [string,string];
      }
      for(const content of [model,visible]){
        assert.ok(content.includes('BETA-KEEP'),'retained finding survives '+format);
        for(const secret of ['ALPHA-OMIT','GAMMA-UNSELECTED',omitted.id,omitted.source.sha256,name,'Fictional beta section first',scopeNote])assert.ok(!content.includes(secret),'omitted from '+format+': '+secret);
        assert.ok(content.includes('[REDACTED]'));
      }
    }
    assert.deepEqual((await f.call(path)).rawPayload,download.rawPayload,'copies do not rewrite frozen report');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM report_disclosures WHERE case_id=$1',[f.caseId])).rows[0].n,0,'no automatic client release');
    await h.button('Revision history',composition);await h.button('Review history for v2',composition);
    await h.captures('composition-history','[aria-label="Saved outline detail"]');
    await f.admin.query('UPDATE sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[tenant,f.investigator.id]);
    assert.equal((await f.call(f.base+'/report-compositions',undefined,f.investigator.headers)).statusCode,401);
    await h.button('Refresh saved outlines',composition);
    await h.wait(`!!document.querySelector('.report-composition [role="alert"]')&&!document.querySelector('.report-composition [aria-label="Saved outline detail"]')&&!document.querySelector('.report-composition [aria-label="Selected finding receipts"]')&&!document.querySelector('.report-composition [aria-label="Composition revision history"]')&&!document.querySelector('.report-composition [aria-label="Composition review history"]')`,'revoked session clears loaded composition state');
    for(const secret of [name,scopeNote,alpha,beta,corrected.sha256])assert.ok(!(await h.text(composition)).includes(secret),'cleared composition '+secret);
    await h.captures('composition-denied',composition);
  }catch(error){await h.failure('composition',error);throw error;}finally{await h.close();}
});

test('sandboxed template browser: separate typed boilerplate, independent pin, explicit preview, reload/apply/retry and revocation',{timeout:180000},async()=>{
  const h=await compositionTemplateBrowser(),{f,browser}=h;
  const name='Fictional browser reusable checklist',body='Fictional separate boilerplate only; no case or source copied.';
  const kinds=['task','objective','question','note'] as const;
  try{
    await f.finding('Fictional unrelated SOURCE-DO-NOT-COPY dispatch account.');
    await h.navigate(f.investigator.headers,'Tasks');await h.button('New boilerplate template',templates);
    await h.fill('Template name',name,templates);await h.fill('Purpose of this boilerplate','Fictional planning checklist with explicit investigator choices.',templates);
    for(const [i,kind] of kinds.entries()){
      if(i)await h.button('Add checklist / work entry',templates);
      const pane='.task-templates form .template-entry:nth-of-type('+(i+1)+')';
      await h.select('Work type',kind,pane);await h.fill('Boilerplate title','Fictional '+kind+' checklist entry',pane);await h.fill('Boilerplate body',body,pane);
      await h.fill('Investigator timing guidance','Fictional investigator guidance only; no service commitment.',pane);
    }
    await h.fill('Reason for this version','Fictional separately authored version for the browser exercise.',templates);
    await h.check('I authored separate boilerplate;',templates);await h.button('Save immutable version',templates);
    await h.wait(`!!document.querySelector('[aria-label="Selected template version"]')`,'saved typed template');
    const saved=(await f.must<{items:TaskTemplateRevision[]}>(f.base+'/task-templates')).items[0]!;
    const t=await f.must<TaskTemplateRevision>(f.base+'/task-templates/'+saved.id);
    assert.equal(t.version,1);assert.equal(t.authorId,f.investigator.id);assert.deepEqual(t.payload.fields.entries.map(e=>e.kind),kinds);
    assert.equal(await browser.evaluate(`!![...document.querySelectorAll('.task-templates button')].find(b=>b.textContent==='Independently accept pinned version')`),false);
    await h.navigate(f.reviewer.headers,'Tasks');await h.button(name,'.template-register',true);
    await h.fill('Decision reason','Fictional independent review of separate source-free boilerplate.',templates);
    await h.check('I inspected this exact version.',templates);await h.button('Independently accept pinned version',templates);
    await h.wait(`document.querySelector('[aria-label="Selected template version"]')?.textContent.includes('Review: accepted')`,'independent template acceptance');
    const accepted=await f.must<TaskTemplateRevision>(f.base+'/task-templates/'+t.id);assert.equal(accepted.review!.reviewerId,f.reviewer.id);
    await h.navigate(f.investigator.headers,'Tasks');await h.button(name,'.template-register',true);
    // A later draft must not replace the explicitly selected accepted version.
    await h.button('Correct current version',templates);await h.fill('Purpose of this boilerplate','Fictional corrected purpose awaiting a separate new review.',templates);
    await h.fill('Reason for this version','Fictional correction retained separately from accepted version one.',templates);
    await h.check('I authored separate boilerplate;',templates);await h.button('Save immutable version',templates);
    await h.wait(`document.querySelector('[aria-label="Selected template version"]')?.textContent.includes('pinned version 2')`,'new draft version');
    await h.button('Version history',templates);await h.button('Inspect / pin version 1',templates);
    await h.wait(`document.querySelector('[aria-label="Selected template version"]')?.textContent.includes('pinned version 1 (historical)')`,'explicit historical pin');
    await h.button('Choose owners / deadlines for this version',templates);
    const choices='.task-templates form';
    await h.wait(`document.querySelectorAll('.task-templates form select').length===8`,'all explicit owner/deadline controls loaded');
    assert.deepEqual(await browser.evaluate<string[]>(`[...document.querySelectorAll('.task-templates form select')].map(e=>e.value)`),Array(8).fill(''),'no implicit owners or deadlines');
    for(const i of kinds.keys()){
      const pane=choices+' .template-entry:nth-of-type('+(i+1)+')';
      await h.select('Owner',i===0?f.investigator.id:'none',pane);await h.select('Deadline choice','none',pane);
    }
    await h.fill('Reason for applying this version','Fictional explicit use of accepted version one with deliberate choices.',templates);
    await h.check('I chose these owners/deadlines explicitly;',templates);await h.button('Save application preview',templates);
    await h.wait(`!!document.querySelector('[aria-label="Exact application preview"]')`,'persisted application preview');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM case_work_items WHERE case_id=$1',[f.caseId])).rows[0].n,0,'preview creates no work');
    const pointers=await browser.evaluate<Array<[string,string]>>(`Object.entries(sessionStorage).filter(([k])=>k.endsWith(':task-template-preview'))`);assert.equal(pointers.length,1);
    const pointer=JSON.parse(pointers[0]![1]) as {id:string};assert.deepEqual(Object.keys(pointer),['id']);assert.match(pointer.id,/^[a-f0-9-]{36}$/);
    const preview=await f.must<TaskTemplatePreview>(f.base+'/task-template-previews/'+pointer.id,undefined,f.investigator.headers);
    assert.equal(preview.payload.templateVersion,1);assert.equal(preview.payload.templateSha256,t.sha256);assert.equal(preview.payload.reviewId,accepted.review!.id);
    assert.ok(!JSON.stringify(preview).includes('SOURCE-DO-NOT-COPY'));assert.deepEqual(preview.payload.entries.map(e=>e.dueDate),Array(4).fill(null));
    await h.captures('template-preview','[aria-label="Exact application preview"]');await h.reload(templates);
    await h.wait(`document.querySelector('[aria-label="Exact application preview"]')?.textContent.includes(${JSON.stringify(preview.sha256)})`,'same preview recovered after reload');
    assert.ok(await browser.evaluate<boolean>(`(${h.textElement('button','Apply exact saved preview',templates)}).matches(':disabled')`),'recovery needs renewed explicit confirmation');
    await h.check('I inspected the exact preview',templates);await h.button('Apply exact saved preview',templates);
    await h.wait(`document.querySelector('[aria-label="Immutable application receipt"]')?.textContent.includes(${JSON.stringify(pointer.id)})`,'exact immutable application receipt');
    const receipt=await f.must<TaskTemplateApplication>(f.base+'/task-template-applications/'+pointer.id);
    assert.equal(receipt.templateVersion,1);assert.equal(receipt.templateSha256,t.sha256);assert.equal(receipt.previewSha256,preview.sha256);
    assert.deepEqual(receipt.initialItems.map(e=>e.kind),kinds);assert.deepEqual(receipt.initialItems.map(e=>e.status),['To do','Open','Open','Recorded']);
    assert.ok(receipt.initialItems.every(e=>e.version===1&&e.parentId===null&&e.body===body&&e.dueDate===null));
    assert.deepEqual(receipt.initialItems.map(e=>e.ownerId),[f.investigator.id,null,null,null]);
    const rows=await f.pool.query('SELECT source_links FROM case_work_revisions WHERE case_id=$1',[f.caseId]);assert.equal(rows.rowCount,4);assert.ok(rows.rows.every(r=>JSON.stringify(r.source_links)==='[]'));
    assert.equal((await browser.evaluate<string[]>('Object.keys(sessionStorage)')).filter(k=>k.endsWith(':task-template-preview')).length,0,'successful application clears only the retry pointer');
    await h.button('Recover existing application receipt',templates);
    await h.wait(`document.querySelector('.task-templates [role="status"]')?.textContent.includes('All selected template entries were created atomically.')`,'same application retry completed');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM case_work_items WHERE case_id=$1',[f.caseId])).rows[0].n,4);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM case_task_template_applications WHERE case_id=$1',[f.caseId])).rows[0].n,1);
    await h.reload(templates);await h.button('Application receipts',templates);await h.button('Inspect original application receipt',templates);
    await h.wait(`document.querySelector('[aria-label="Immutable application receipt"]')?.textContent.includes(${JSON.stringify(pointer.id)})`,'persisted receipt reopened after reload');
    await h.captures('template-applied','[aria-label="Immutable application receipt"]');
    await f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.investigator.id]);
    assert.equal((await f.call(f.base+'/task-template-applications/'+pointer.id,undefined,f.investigator.headers)).statusCode,404);
    await h.button('Refresh templates',templates);
    await h.wait(`!!document.querySelector('.task-templates [role="alert"]')&&!document.querySelector('[aria-label="Immutable application receipt"]')&&!document.querySelector('[aria-label="Exact application preview"]')&&!document.querySelector('[aria-label="Template application history"]')`,'revoked case access clears template data');
    for(const secret of [name,body,t.sha256,pointer.id])assert.ok(!(await h.text(templates)).includes(secret),'cleared template '+secret);
    await h.captures('template-denied',templates);
  }catch(error){await h.failure('templates',error);throw error;}finally{await h.close();}
});
