import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {ocrFixture} from './support/ocr-fixture.js';
import {makeOcrDerivative,ocrWords,ocrProfile,ocrProfileDigest,ocrArtifactLock} from '../src/ocr-derivative.js';
import {documentCitation} from '../src/document-citation.js';
import {sha256} from '../src/text-derivative.js';
import {inspectDocumentDerivative} from '../../web/src/documentInspection.js';
import {verifyCitation} from '../../web/src/citationRequest.js';
import {validateNativeQualification} from '../src/native-document-worker.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('OCR boundaries preserve exact raw rows, original/render/TSV hashes and independent byte offsets',()=>{
 const f=ocrFixture(),d=f.output.derivative;assert.equal(f.output.digest,'b116b472db2aa4d768cf8f4c68fa7b64913781e88d7ab804620b52b117cea9eb');assert.equal(d.text,'ATLAS\n60');assert.equal(d.offsetBasis,'ocr_utf8_not_original_pdf');assert.equal(d.coverage.completeExtractionVerified,false);
 assert.deepEqual(d.references[1]?.bbox,{l:16,r:21,b:11,t:6,origin:'TOPLEFT'});assert.equal(d.references[1]?.ocr.tsvRow,4);assert.equal(d.references[1]?.ocr.confidence,89.5);assert.equal(d.references[1]?.startByte,6);
 const c=documentCitation(f.output,{derivativeDigest:f.output.digest,itemRef:'#/texts/1',startByte:6,endByte:8,quote:'60'});assert.equal(c.citation.page,1);assert.equal(c.citation.offsetBasis,'ocr_utf8_not_original_pdf');
 assert.equal(d.ocr.artifacts[0]?.inputPngDigest,sha256(f.png));assert.equal(d.ocr.artifacts[0]?.rawTsvDigest,sha256(f.tsv));assert.equal(sha256(readFileSync(root+'research/runtime_artifacts/tesseract-baseline.lock.json')),ocrArtifactLock);
});
test('independent Python implementation replays fabricated boundary bytes without an OCR or PDF dependency',()=>{
 const f=ocrFixture();const r=spawnSync('python3',['-c','import json,sys,base64;from tools.verify_ocr_derivative import ocr_derivative;v=json.load(sys.stdin);print(json.dumps(ocr_derivative(base64.b64decode(v["raw"]),v["context"],base64.b64decode(v["original"]))))'],{cwd:root,input:JSON.stringify({raw:f.result.raw.toString('base64'),original:f.original.toString('base64'),context:f.context}),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),f.output.derivative);
});
test('OCR rejects foreign scope, drift, unsuccessful output, duplicates, malformed geometry and altered PNG streams',()=>{
 const f=ocrFixture();for(const key of ['tenantId','caseId','jobId','evidenceId','sourceDigest','authorityVersion'] as const){const context={...f.context,[key]:key==='authorityVersion'?2:'foreign'};assert.throws(()=>makeOcrDerivative(f.original,f.context,{...f.result,context}));}
 assert.throws(()=>makeOcrDerivative(Buffer.concat([f.original,Buffer.from('x')]),f.context,f.result));assert.throws(()=>makeOcrDerivative(f.original,f.context,{...f.result,successful:false}));assert.throws(()=>makeOcrDerivative(f.original,f.context,{...f.result,successful:1 as unknown as boolean}));assert.throws(()=>makeOcrDerivative(f.original,f.context,{...f.result,profileDigest:'f'.repeat(64)}));
 for(const mutate of [(e:typeof f.envelope)=>e.artifactLock='f'.repeat(64),(e:typeof f.envelope)=>e.pages[0]!.page=2,(e:typeof f.envelope)=>e.pages[0]!.width=63,(e:typeof f.envelope)=>e.pages[0]!.pngBase64=Buffer.concat([f.png,Buffer.from('x')]).toString('base64')]){const e=structuredClone(f.envelope);mutate(e);assert.throws(()=>makeOcrDerivative(f.original,f.context,{...f.result,raw:Buffer.from(JSON.stringify(e))}));}
 assert.throws(()=>makeOcrDerivative(f.original,f.context,{...f.result,raw:Buffer.from(f.result.raw.toString().replace('{','{"format":"duplicate",'))}));
 for(const bad of [f.tsv.toString().replace('89.5','NaN'),f.tsv.toString().replace('\t32\t12\t','\t63\t12\t'),f.tsv.toString().replace('\t60\n','\t60\textra\n'),f.tsv.toString().replace('\n5\t','\n9\t')]){assert.throws(()=>ocrWords(Buffer.from(bad),64,64));}
});
test('browser inspection recognises the separately versioned OCR result and citation basis',async()=>{
 const f=ocrFixture(),job={id:f.context.jobId,caseId:f.context.caseId,evidenceId:f.context.evidenceId,sourceDigest:f.context.sourceDigest,authorityVersion:1,kind:'tesseract_scan_lab_v1',status:'succeeded'};
 const r={...f.context,jobId:job.id,status:'unreviewed_derivative',processedAt:'2026-10-29T00:00:00Z',profile:JSON.parse(ocrProfile),profileDigest:ocrProfileDigest,rawDigest:f.output.rawDigest,derivativeDigest:f.output.digest,derivative:f.output.derivative};
 const d=await inspectDocumentDerivative(r,job);assert.equal(d.method,'ocr');assert.equal(d.offsetBasis,'ocr_utf8_not_original_pdf');assert.equal(d.references[1]?.text,'60');await assert.rejects(inspectDocumentDerivative(r,{...job,kind:'native_pdf_lab_v1'}));
 const citation=documentCitation(f.output,{derivativeDigest:f.output.digest,itemRef:'#/texts/1',startByte:6,endByte:8,quote:'60'}),receipt={id:f.context.jobId,createdBy:f.context.tenantId,createdAt:r.processedAt,citationDigest:citation.digest,citation:citation.citation};assert.equal((await verifyCitation(receipt,d)).citation.offsetBasis,'ocr_utf8_not_original_pdf');await assert.rejects(verifyCitation(receipt,{...d,offsetBasis:'extracted_utf8_not_original_pdf'}));
});
test('OCR qualification requires recent complete actual isolation evidence',()=>{
 assert.throws(()=>validateNativeQualification({},true));assert.throws(()=>validateNativeQualification({status:'host_probe_passed',profile:'runtime-1g',imageId:'sha256:'+'a'.repeat(64),repoDigests:[],checkedAt:new Date().toISOString()},true));
});

test('expanded OCR keeps v1 immutable, rejects profile substitution and independently replays the larger bound',async()=>{
 const {ocrExpandedKind,ocrExpandedProfile,ocrExpandedProfileDigest}=await import('../src/ocr-derivative.js');const f=ocrFixture();assert.equal(ocrProfileDigest,'3eaf9e8346c3496729f98a2c846abc75d4afac066f3e8c3c9b4ada6acb323e76');assert.equal(JSON.parse(ocrProfile).maxOriginalBytes,65536);assert.equal(JSON.parse(ocrExpandedProfile).maxOriginalBytes,262144);
 const original=Buffer.concat([f.original,Buffer.alloc(262144-f.original.length,32)]),context={...f.context,sourceDigest:sha256(original)},raw=Buffer.from(JSON.stringify({...f.envelope,originalSha256:context.sourceDigest})),result={context,profileDigest:ocrExpandedProfileDigest,successful:true,raw};
 assert.throws(()=>makeOcrDerivative(original,context,result));assert.throws(()=>makeOcrDerivative(f.original,f.context,f.result,ocrExpandedKind));assert.throws(()=>makeOcrDerivative(original,context,{...result,profileDigest:ocrProfileDigest},ocrExpandedKind));assert.throws(()=>makeOcrDerivative(Buffer.concat([original,Buffer.from('x')]),context,result,ocrExpandedKind));assert.throws(()=>makeOcrDerivative(original,context,result,'unknown'));
 const output=makeOcrDerivative(original,context,result,ocrExpandedKind);assert.equal(output.derivative.text,f.output.derivative.text);assert.equal(output.derivative.profileDigest,ocrExpandedProfileDigest);
 const replay=spawnSync('python3',['-c','import json,sys,base64;from tools.verify_ocr_derivative import ocr_derivative;v=json.load(sys.stdin);print(json.dumps(ocr_derivative(base64.b64decode(v["raw"]),v["context"],base64.b64decode(v["original"]),v["profile"])))'],{cwd:root,input:JSON.stringify({raw:raw.toString('base64'),original:original.toString('base64'),context,profile:ocrExpandedProfileDigest}),encoding:'utf8'});assert.equal(replay.status,0,replay.stderr);assert.deepEqual(JSON.parse(replay.stdout),output.derivative);
 const job={id:context.jobId,caseId:context.caseId,evidenceId:context.evidenceId,sourceDigest:context.sourceDigest,authorityVersion:1,kind:ocrExpandedKind,status:'succeeded'},receipt={...context,status:'unreviewed_derivative',processedAt:'2026-10-29T00:00:00Z',profile:JSON.parse(ocrExpandedProfile),profileDigest:ocrExpandedProfileDigest,rawDigest:output.rawDigest,derivativeDigest:output.digest,derivative:output.derivative};assert.equal((await inspectDocumentDerivative(receipt,job)).method,'ocr');await assert.rejects(inspectDocumentDerivative(receipt,{...job,kind:'tesseract_scan_lab_v1'}));
});
