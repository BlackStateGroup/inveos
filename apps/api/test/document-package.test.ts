import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {makeDocumentDerivative,documentProfile,documentProfileDigest} from '../src/document-derivative.js';
import {documentCitation} from '../src/document-citation.js';
import {documentReview} from '../src/document-review.js';
import {documentClaim,documentClaimDecision} from '../src/document-claim.js';
import {sha256} from '../src/text-derivative.js';

const root=fileURLToPath(new URL('../../../',import.meta.url)),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,at='2026-10-29T12:00:00.000Z';
function fixture(){
 const pdf=spawnSync('python3',['-c','import sys;from tools.synthetic_pdf import digital_pdf;sys.stdout.buffer.write(digital_pdf())'],{cwd:root});assert.equal(pdf.status,0);
 const raw=Buffer.from(JSON.stringify(JSON.parse(readFileSync(join(root,'research/runtime_artifacts/native-boundary-receipt.json'),'utf8')).runs[0].nativeDocument));
 const context={tenantId:id(1),caseId:id(2),jobId:id(3),evidenceId:id(4),sourceDigest:sha256(pdf.stdout),authorityVersion:1},output=makeDocumentDerivative(pdf.stdout,context,{context,profileDigest:documentProfileDigest,successful:true,raw});
 const selection={derivativeDigest:output.digest,itemRef:'#/texts/1',startByte:34,endByte:67,quote:'FICTIONAL INVEOS repeated passage'},citation=documentCitation(output,selection);
 const review=documentReview(id(5),citation,{id:id(6),previousReviewId:null,citationDigest:citation.digest,decision:'accepted',reason:'Fictional independent comparison.',originalCompared:true},id(8),at,null);
 const claim=documentClaim(id(5),citation,{...review.record,digest:review.digest},{id:id(9),citationDigest:citation.digest,correspondenceReviewId:id(6),correspondenceReviewDigest:review.digest,text:'Fictional interpretation only.'},id(7),at);
 const decision=documentClaimDecision(claim,{id:id(10),claimDigest:claim.digest,accepted:true,reason:'Fictional independent finding decision.'},id(8),at);
 const f={kind:'derived_document',id:id(10),text:claim.record.text,reviewer:id(8),reviewedAt:at,
  source:{id:id(4),filename:'fictional.pdf',sha256:context.sourceDigest,sourceTime:at,receivedTime:at,authorityId:id(11),authorityVersion:1},
  extraction:{jobId:id(3),authorityVersion:1,attempt:1,processedAt:at,profile:documentProfile,profileDigest:documentProfileDigest,rawDigest:output.rawDigest,derivativeDigest:output.digest},
  reference:{citationId:id(5),citationDigest:citation.digest,offsetBasis:citation.citation.offsetBasis,...selection,page:2,bbox:citation.citation.bbox},
  correspondence:{id:id(6),digest:review.digest,reviewer:id(8),reviewedAt:at,reason:review.record.reason},
  interpretation:{claimId:id(9),claimDigest:claim.digest,decisionId:id(10),decisionDigest:decision.digest,reason:decision.record.reason},limitations:'Fictional untrusted fixture.'};
 const report={status:'draft_not_released',case:{id:id(2),ref:'SYN-PACKAGE',title:'Fictional report',client:'Fictional client',scope:'Fictional test',jurisdiction:'Test'},findings:[],documentFindings:[f],limitations:'Fictional package test'},reportBytes=Buffer.from(JSON.stringify(report));
 const packageData={format:'inveos_document_report_package_v1',reportSha256:sha256(reportBytes),reportBase64:reportBytes.toString('base64'),exhibits:[{findingId:id(10),candidateCreatedBy:id(7),originalBase64:pdf.stdout.toString('base64'),rawBase64:raw.toString('base64'),derivativeBase64:output.bytes.toString('base64'),citationBase64:citation.bytes.toString('base64'),reviewBase64:[review.bytes.toString('base64')],claimBase64:claim.bytes.toString('base64'),decisionBase64:decision.bytes.toString('base64')}]};
 return {packageData,report};
}
function check(raw:string,expected?:string){
 const dir=mkdtempSync(join(tmpdir(),'inveos-package-'));try{const path=join(dir,'package.json');writeFileSync(path,raw);return spawnSync('python3',[join(root,'tools/verify_document_package.py'),path,...(expected?['--expected-report-sha256',expected]:[])],{encoding:'utf8',timeout:10000});}finally{rmSync(dir,{recursive:true,force:true});}
}
test('offline document package verifier independently replays recorded native lineage and exact reviewed occurrence',()=>{
 const {packageData:p}=fixture(),r=check(JSON.stringify(p),p.reportSha256);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).documentFindingsChecked,1);assert.equal(JSON.parse(r.stdout).trustedReportDigestMatched,true);
});
test('offline package rejects missing, duplicate, malformed, substituted and path-bearing inputs',()=>{
 const {packageData:base}=fixture();
 for(const key of ['originalBase64','rawBase64','derivativeBase64','citationBase64','claimBase64','decisionBase64'] as const){const p=structuredClone(base);p.exhibits[0]![key]=Buffer.from('{}').toString('base64');assert.equal(check(JSON.stringify(p)).status,1,key);}
 for(const p of [{...base,exhibits:[]},{...base,exhibits:[base.exhibits[0],base.exhibits[0]]},{...base,path:'../../escape'},{...base,exhibits:[{...base.exhibits[0],path:'../../escape'}]},{...base,exhibits:[{...base.exhibits[0],reviewBase64:[]}]}])assert.equal(check(JSON.stringify(p)).status,1);
 assert.equal(check(JSON.stringify(base).replace('{','{"format":"duplicate",')).status,1);
 const p=structuredClone(base);p.exhibits[0]!.rawBase64='!!!!';assert.equal(check(JSON.stringify(p)).status,1);
});
test('trusted report fingerprint detects a rehashed narrative replacement; rehashed derivation still must replay raw output',()=>{
 const {packageData:p,report}=fixture(),trusted=p.reportSha256;report.documentFindings[0]!.limitations='Altered narrative';const raw=Buffer.from(JSON.stringify(report));p.reportBase64=raw.toString('base64');p.reportSha256=sha256(raw);assert.equal(check(JSON.stringify(p),trusted).status,1);
 const d=JSON.parse(Buffer.from(p.exhibits[0]!.derivativeBase64,'base64').toString());d.coverage.completeExtractionVerified=true;const forged=Buffer.from(JSON.stringify(d));p.exhibits[0]!.derivativeBase64=forged.toString('base64');report.documentFindings[0]!.extraction.derivativeDigest=sha256(forged);const changed=Buffer.from(JSON.stringify(report));p.reportBase64=changed.toString('base64');p.reportSha256=sha256(changed);assert.equal(check(JSON.stringify(p)).status,1);
});
