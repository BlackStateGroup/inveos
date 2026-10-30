import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {verifyReportDocxDownload} from '../../web/src/reportDocxDownload.js';

test('DOCX recipient download binds the exact trusted bytes and report headers, rejecting tampering and mismatched headers',async()=>{
 const bytes=Buffer.concat([Buffer.from([0x50,0x4b,3,4]),Buffer.from('Fictional ZIP signature fixture; not a semantic DOCX test.')]),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,digest=createHash('sha256').update(bytes).digest('hex'),report='a'.repeat(64);
 assert.equal((await verifyReportDocxDownload(buffer,digest,report,digest,report)).docxSha256,digest);
 for(const args of [[digest,report,'0'.repeat(64),report],[digest,report,digest,'0'.repeat(64)],['invalid',report,'invalid',report]] as const)await assert.rejects(verifyReportDocxDownload(buffer,args[0],args[1],args[2],args[3]));
 const changed=buffer.slice(0);new Uint8Array(changed)[20]=0;await assert.rejects(verifyReportDocxDownload(changed,digest,report,digest,report));
 await assert.rejects(verifyReportDocxDownload(buffer.slice(0,10),digest,report,digest,report));
});

test('historical DOCX v1 golden bytes remain stable beside the distinct disclosure-capable v2 profile',async()=>{
 const {buildReportDocx}=await import('../src/report-docx.js');
 const report={status:'draft_not_released' as const,case:{id:'00000000-0000-4000-8000-000000000001',ref:'SYN',title:'Fictional profile continuity',client:'Fictional client',scope:'Fictional only',jurisdiction:'England'},findings:[],investigation:{status:'working_context_not_findings' as const,objectives:[],questions:[],hypotheses:[],blockers:[]},limitations:'Fictional only'};
 const old=buildReportDocx(report,'a'.repeat(64),{}),next=buildReportDocx(report,'a'.repeat(64),{},'inveos_report_docx_v2');assert.equal(old.digest,'197e880de5ab8ea5060e9758f86d318dbae4d8998896602a6fd0f8ab0f31df85');assert.notEqual(next.digest,old.digest);assert.equal(next.model.profile,'inveos_report_docx_v2');assert.match(next.model.paragraphs[0]!,/VERIFY DISCLOSURE APPROVAL SEPARATELY/);assert.throws(()=>buildReportDocx(report,'a'.repeat(64),{},'invented-profile'),/Unknown/);
});
