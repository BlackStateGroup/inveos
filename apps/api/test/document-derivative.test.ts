import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {makeDocumentDerivative,documentProfileDigest,type DocumentContext} from '../src/document-derivative.js';
import {sha256} from '../src/text-derivative.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const pdf=spawnSync('python3',['-c','import sys;from tools.synthetic_pdf import digital_pdf;sys.stdout.buffer.write(digital_pdf())'],{cwd:root});
assert.equal(pdf.status,0,pdf.stderr.toString());const original=pdf.stdout;
// Replay recorded actual parser data; this test does not execute an upstream parser.
const recorded=JSON.parse(readFileSync(new URL('../../../research/runtime_artifacts/native-boundary-receipt.json',import.meta.url),'utf8')).runs[0].nativeDocument;
const context:DocumentContext={tenantId:'fictional-tenant',caseId:'fictional-case',jobId:'fictional-job',evidenceId:'fictional-evidence',authorityVersion:1,sourceDigest:sha256(original)};
function run(data=structuredClone(recorded),ctx=context,raw=Buffer.from(JSON.stringify(data))){return makeDocumentDerivative(original,context,{context:ctx,profileDigest:documentProfileDigest,successful:true,raw});}

test('recorded native output retains second-page occurrence and original-linked unreviewed lineage',()=>{
  const output=run(),d=output.derivative;
  assert.equal(d.references[1]!.page,2);assert.equal(d.references[1]!.startByte,34);assert.equal(d.references[1]!.endByte,67);
  assert.equal(d.references[1]!.bbox.origin,'BOTTOMLEFT');assert.equal(d.references[1]!.bbox.l,72);
  assert.equal(d.text.slice(34,67),'FICTIONAL INVEOS repeated passage');assert.equal(d.context.sourceDigest,sha256(original));
  assert.equal(d.reviewState,'unreviewed');assert.equal(d.coverage.completeExtractionVerified,false);
  assert.equal(output.digest,run().digest);
});
test('empty and mixed text coverage retain original page numbering and always require human completeness assessment',()=>{
  const data=structuredClone(recorded);data.texts=[data.texts[0]];
  assert.deepEqual(run(data).derivative.coverage.pagesWithoutText,[2]);
  data.texts=[];const d=run(data).derivative;assert.deepEqual(d.coverage.pagesWithoutText,[1,2]);assert.equal(d.coverage.disposition,'needs_page_review');assert.equal(d.text,'');
});
test('context, runtime profile, incomplete outcome and original substitution fail closed',()=>{
  for(const key of ['tenantId','caseId','jobId','evidenceId','sourceDigest'] as const)assert.throws(()=>run(recorded,{...context,[key]:'wrong'}));
  assert.throws(()=>run(recorded,{...context,authorityVersion:2}));
  const result={context,profileDigest:documentProfileDigest,successful:true,raw:Buffer.from(JSON.stringify(recorded))};
  assert.throws(()=>makeDocumentDerivative(original,context,{...result,profileDigest:'f'.repeat(64)}));
  assert.throws(()=>makeDocumentDerivative(original,context,{...result,successful:false}));
  assert.throws(()=>makeDocumentDerivative(Buffer.from('%PDF-forged'),context,result));
  assert.throws(()=>makeDocumentDerivative(Buffer.alloc(65537),context,result));
});
test('duplicate and escaped duplicate keys, invalid UTF-8, oversized and deeply nested JSON are rejected',()=>{
  const raw=JSON.stringify(recorded);
  for(const value of [Buffer.from('{"texts":[],"texts":[]}'),Buffer.from('{"texts":[],"te\\u0078ts":[]}'),Buffer.from([255]),Buffer.alloc(1048577),Buffer.from('['.repeat(65)+'0'+']'.repeat(65))])assert.throws(()=>run(recorded,context,value));
  const spaced=run(recorded,context,Buffer.from(' '+raw));assert.notEqual(spaced.rawDigest,run().rawDigest);
});
test('invalid page identity, geometry, partial spans and unsupported table content cannot produce a citation',()=>{
  const mutations=[(d:typeof recorded)=>{d.pages['2'].page_no=1;},(d:typeof recorded)=>{d.pages['2'].size.width=0;},
    (d:typeof recorded)=>{d.texts[0].prov[0].page_no=3;},(d:typeof recorded)=>{d.texts[0].prov[0].charspan=[0,1];},
    (d:typeof recorded)=>{d.texts[0].prov.push(d.texts[0].prov[0]);},(d:typeof recorded)=>{d.texts[0].prov[0].bbox.r=700;},
    (d:typeof recorded)=>{d.texts[0].prov[0].bbox.b=750;},(d:typeof recorded)=>{d.texts[0].self_ref='#/texts/1';},
    (d:typeof recorded)=>{d.tables=[{text:'unhandled'}];},(d:typeof recorded)=>{d.texts[0].text='\ud800';}];
  for(const mutate of mutations){const d=structuredClone(recorded);mutate(d);assert.throws(()=>run(d));}
});
test('Unicode spans are UTF-8 bytes while native charspans count Unicode codepoints',()=>{
  const d=structuredClone(recorded);for(const item of d.texts){item.text='Fictional á😀';item.prov[0].charspan=[0,Array.from(item.text).length];}
  const output=run(d).derivative,ref=output.references[1]!;assert.equal(ref.startByte,Buffer.byteLength(d.texts[0].text)+1);
  assert.equal(Buffer.from(output.text).subarray(ref.startByte,ref.endByte).toString(),'Fictional á😀');
});

async function clientFixture(){
  const {documentProfile}=await import('../src/document-derivative.js');
  const output=run();const job={id:context.jobId,caseId:context.caseId,evidenceId:context.evidenceId,sourceDigest:context.sourceDigest,authorityVersion:1,kind:'native_pdf_lab_v1',status:'succeeded'};
  const response={jobId:job.id,caseId:job.caseId,evidenceId:job.evidenceId,sourceDigest:job.sourceDigest,authorityVersion:1,status:'unreviewed_derivative',processedAt:'2026-10-29T00:00:00Z',profile:JSON.parse(documentProfile),profileDigest:documentProfileDigest,rawDigest:output.rawDigest,derivativeDigest:output.digest,derivative:output.derivative};
  return {job,response};
}
test('browser contract validates stored document identity and both repeated page passages',async()=>{
  const {inspectDocumentDerivative}=await import('../../web/src/documentInspection.js');
  const {job,response}=await clientFixture();const checked=await inspectDocumentDerivative(response,job);
  assert.equal(checked.pageCount,2);assert.equal(checked.references[1]!.page,2);assert.equal(checked.references[1]!.text,'FICTIONAL INVEOS repeated passage');
});
test('browser contract rejects substituted lineage, digest and false review or completeness states',async()=>{
  const {inspectDocumentDerivative}=await import('../../web/src/documentInspection.js');const {job,response}=await clientFixture();
  for(const change of [{jobId:'wrong'},{evidenceId:'wrong'},{authorityVersion:2},{sourceDigest:'a'.repeat(64)},{profileDigest:'b'.repeat(64)},{rawDigest:'c'.repeat(64)},{derivativeDigest:'d'.repeat(64)},{status:'reviewed'}])await assert.rejects(inspectDocumentDerivative({...response,...change},job));
  for(const mode of ['context','complete','range','box','coverage'] as const){const r=structuredClone(response);
    if(mode==='context')r.derivative.context.jobId='wrong';if(mode==='complete')r.derivative.coverage.completeExtractionVerified=true;
    if(mode==='range')r.derivative.references[1]!.startByte=0;if(mode==='box')r.derivative.references[0]!.bbox.l=-1;
    if(mode==='coverage')r.derivative.coverage.pagesWithoutText=[1];r.derivativeDigest=sha256(JSON.stringify(r.derivative));
    await assert.rejects(inspectDocumentDerivative(r,job));
  }
});
test('browser contract preserves missing-page warning and treats extracted markup as plain text',async()=>{
  const {inspectDocumentDerivative}=await import('../../web/src/documentInspection.js');const {job,response}=await clientFixture();
  const data=structuredClone(recorded);data.texts=[data.texts[0]];data.texts[0].text='<script>fictional()</script>';data.texts[0].prov[0].charspan=[0,data.texts[0].text.length];
  const output=run(data);const checked=await inspectDocumentDerivative({...response,derivative:output.derivative,derivativeDigest:output.digest,rawDigest:output.rawDigest},job);
  assert.deepEqual(checked.pagesWithoutText,[2]);assert.equal(checked.references[0]!.text,data.texts[0].text);
});

test('page map converts both origins without mutating native coordinates and rejects invalid geometry',async()=>{
  const {displayRegion}=await import('../../web/src/documentRegion.js');
  const page={width:200,height:400},bottom={l:20,r:100,b:300,t:360,origin:'BOTTOMLEFT'};
  const before=structuredClone(bottom);
  assert.deepEqual(displayRegion(page,bottom),{x:0.1,y:1-0.9,width:0.4,height:0.15});
  assert.deepEqual(displayRegion(page,{...bottom,t:40,b:100,origin:'TOPLEFT'}),{x:0.1,y:0.1,width:0.4,height:0.15});
  assert.deepEqual(bottom,before);
  for(const change of [{l:-1},{r:201},{b:401},{t:300},{origin:'unknown'},{l:NaN}])assert.throws(()=>displayRegion(page,{...bottom,...change}));
  assert.throws(()=>displayRegion({width:0,height:400},bottom));
  const {job,response}=await clientFixture();const {inspectDocumentDerivative}=await import('../../web/src/documentInspection.js');
  const checked=await inspectDocumentDerivative(response,job);assert.deepEqual(checked.pages,response.derivative.pages);
});

test('document citation binds the selected repeated occurrence and rejects cross-item ranges',async()=>{
 const {documentCitation}=await import('../src/document-citation.js');const output=run();
 const selection={derivativeDigest:output.digest,itemRef:'#/texts/1',startByte:34,endByte:67,quote:'FICTIONAL INVEOS repeated passage'};
 const c=documentCitation(output,selection);assert.equal(c.citation.page,2);assert.equal(c.citation.status,'unreviewed_candidate');assert.equal(c.citation.offsetBasis,'extracted_utf8_not_original_pdf');
 for(const patch of [{itemRef:'#/texts/0'},{startByte:0},{endByte:68},{quote:'invented'},{derivativeDigest:'f'.repeat(64)}])assert.throws(()=>documentCitation(output,{...selection,...patch}));
});
test('document citations enforce UTF-8 boundaries without normalising quotes',async()=>{
 const {documentCitation}=await import('../src/document-citation.js');const data=structuredClone(recorded);data.texts=[data.texts[0]];data.texts[0].text='Fictional café';data.texts[0].prov[0].charspan=[0,14];const output=run(data);
 const s={derivativeDigest:output.digest,itemRef:'#/texts/0',startByte:10,endByte:15,quote:'café'};assert.equal(documentCitation(output,s).citation.quote,'café');
 assert.throws(()=>documentCitation(output,{...s,startByte:14,quote:'é'}));assert.throws(()=>documentCitation(output,{...s,endByte:14,quote:'caf'}));
});

async function citationClientFixture(){
 const {documentCitation}=await import('../src/document-citation.js');const {inspectDocumentDerivative}=await import('../../web/src/documentInspection.js');
 const {job,response}=await clientFixture(),d=await inspectDocumentDerivative(response,job),output=run();
 output.derivative.context={tenantId:'11111111-1111-4111-8111-111111111111',caseId:d.caseId,jobId:d.jobId,evidenceId:d.evidenceId,sourceDigest:d.sourceDigest,authorityVersion:d.authorityVersion};
 const {wholePassage}=await import('../../web/src/citationRequest.js');
 return {d,receipt:(id:string,itemRef='#/texts/1')=>{const c=documentCitation(output,wholePassage(d,itemRef));return {id,createdBy:'22222222-2222-4222-8222-222222222222',createdAt:'2026-10-29T00:00:00Z',citationDigest:c.digest,citation:c.citation};}};
}
test('citation client verifies exact occurrence and rejects rehashed false lineage and approval',async()=>{
 const {verifyCitation}=await import('../../web/src/citationRequest.js'),f=await citationClientFixture(),id='33333333-3333-4333-8333-333333333333',r=f.receipt(id);
 assert.equal((await verifyCitation(r,f.d,id)).citation.page,2);
 for(const patch of [{page:1},{status:'approved'},{quote:'invented'},{startByte:0},{itemRef:'#/texts/0'},{rawDigest:'f'.repeat(64)}]){const changed={...r,citation:{...r.citation,...patch}};changed.citationDigest=sha256(JSON.stringify(changed.citation));await assert.rejects(verifyCitation(changed,f.d,id));}
 await assert.rejects(verifyCitation({...r,citationDigest:'a'.repeat(64)},f.d,id));await assert.rejects(verifyCitation(r,{...f.d,caseId:'foreign'},id));
});
test('citation retry persists only identity before send, recovers same passage and rejects mismatched receipt',async()=>{
 const {pendingCitation,saveCitationRecoverably}=await import('../../web/src/citationRequest.js'),f=await citationClientFixture();const data=new Map<string,string>(),store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 let first='';await assert.rejects(saveCitationRecoverably(store,'scope',f.d,'#/texts/1',async p=>{first=p.id;assert.equal(pendingCitation(store,'scope')!.id,first);throw new Error('response lost');}));
 assert.ok(!data.get('scope')!.includes('FICTIONAL'));assert.equal(pendingCitation(store,'scope')!.itemRef,'#/texts/1');
 await assert.rejects(saveCitationRecoverably(store,'scope',f.d,'#/texts/0',async p=>f.receipt(p.id,'#/texts/0')));assert.ok(pendingCitation(store,'scope'));
 const r=await saveCitationRecoverably(store,'scope',f.d,'#/texts/0',async(p,s)=>{assert.equal(p.id,first);assert.equal(s.itemRef,'#/texts/1');return f.receipt(p.id);});assert.equal(r.id,first);assert.equal(pendingCitation(store,'scope'),null);
 let sent=false;await assert.rejects(saveCitationRecoverably({...store,setItem:()=>{}},'scope',f.d,'#/texts/1',async()=>{sent=true;}));assert.equal(sent,false);
 store.setItem('scope','{}');await assert.rejects(saveCitationRecoverably(store,'scope',f.d,'#/texts/1',async()=>{sent=true;}));assert.equal(sent,false);
});
