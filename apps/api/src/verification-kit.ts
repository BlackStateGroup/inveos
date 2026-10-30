import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError} from './errors.js';

// Deliberate allowlist: no directory walk, external runtime, research copy or case data.
export const verificationKitFiles=[
 'verify_casework.py','verify_collection_context.py','verify_document_package.py',
 'verify_field_provenance.py','verify_internal_invoice.py','verify_ocr_derivative.py',
 'verify_report.py','verify_report_composition.py','verify_report_docx.py','verify_report_pdf.py',
 'verify_research_context.py','verify_speech_context.py','verify_speech_findings.py','verify_tika_context.py','verify_tika_report.py','verify_transcript.py',
] as const;
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const maxBytes=4*1024*1024;
const instructions=`INVEOS offline verification kit

This kit contains first-party Python source and instructions only. No case data,
credentials, parser/model runtime or network access is required. Use Python 3.11+
with its standard library. Keep all files together. Tika report packages require verify_tika_report.py
and its verify_tika_context.py dependency, both included. Preserve the exact ZIP and
its SHA-256 fingerprint independently from the copy being checked.

Before extracting or running downloaded code, check the ZIP fingerprint against
your independently retained trusted value, for example:
  sha256sum inveos-verification-kit.zip
On macOS use: shasum -a 256 inveos-verification-kit.zip
Then extract to a new directory and inspect the source. manifest.json lists each
file's byte length and SHA-256; it is an inventory, not a digital signature.

Run from the extracted directory, substituting your actual paths and separately
trusted hexadecimal fingerprints. Do not use the placeholder words below.

Report JSON with embedded original source spans:
  python3 verify_report.py /path/report.json --expected-sha256 REPORT_SHA256
Document report package with preserved exhibits:
  python3 verify_document_package.py /path/package.json --expected-package-sha256 PACKAGE_SHA256 --expected-report-sha256 REPORT_SHA256
Approved PDF copy:
  python3 verify_report_pdf.py /path/report.pdf --expected-pdf-sha256 PDF_SHA256 --expected-report-sha256 REPORT_SHA256
Approved DOCX copy:
  python3 verify_report_docx.py /path/report.docx --expected-docx-sha256 DOCX_SHA256 --expected-report-sha256 REPORT_SHA256
Internal invoice draft (only when separately authorised):
  python3 verify_internal_invoice.py /path/invoice.json --expected-sha256 INVOICE_SHA256

The other files are helpers and optional individual context checkers; use --help
where a checker provides a command-line interface. A successful run checks the
declared format and available bytes, spans, provenance and fingerprints. It does
not establish factual truth, accurate device clocks, actor identity, current
access authority, legal compliance, signature authenticity or admissibility.

PDF/DOCX checks verify the copy's bounded semantic content and report binding;
they cannot reverify undisclosed original bytes. A redacted copy does not require
sharing an internal unredacted report with its recipient. Edited DOCX files have
different bytes and do not inherit approval. Preserve originals and use a fresh
review/release for changed content. Keep the kit that was supplied with a report:
a newer verifier may support additional formats but cannot amend old bytes.
`;

// Fixed STORE ZIP, following the existing first-party DOCX writer. No extraction.
// ASCII basenames, fixed 1980 date and bounded inputs make the result reproducible.
function storedZip(parts:Array<[string,Buffer]>){
 const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 const locals:Buffer[]=[],directory:Buffer[]=[];let offset=0;
 if(parts.length>32||new Set(parts.map(([name])=>name)).size!==parts.length)throw new Error('Invalid verifier kit inventory.');
 for(const [path,bytes] of parts){
  if(!/^[a-zA-Z0-9_.-]+$/.test(path)||path==='.'||path==='..'||bytes.length>512*1024)throw new Error('Invalid verifier kit member.');
  const name=Buffer.from(path,'ascii'),local=Buffer.alloc(30),central=Buffer.alloc(46);let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]!^(crc>>>8);crc=(crc^0xffffffff)>>>0;
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  locals.push(local,name,bytes);directory.push(central,name);offset+=local.length+name.length+bytes.length;
 }
 const centre=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(parts.length,8);end.writeUInt16LE(parts.length,10);end.writeUInt32LE(centre.length,12);end.writeUInt32LE(offset,16);
 if(offset+centre.length+end.length>maxBytes)throw new Error('Verifier kit exceeds its byte bound.');return Buffer.concat([...locals,centre,end]);
}

export async function buildVerificationKit(){
 const root=new URL('../../../tools/',import.meta.url),parts:Array<[string,Buffer]>=[];
 for(const name of verificationKitFiles){const bytes=await readFile(new URL(name,root));if(bytes.length>512*1024||Buffer.from(bytes.toString('utf8')).compare(bytes)!==0)throw new Error('Verifier source is not bounded UTF-8.');parts.push([name,bytes]);}
 parts.push(['README.txt',Buffer.from(instructions)]);parts.sort(([a],[b])=>a<b?-1:a>b?1:0);
 const manifest=Buffer.from(JSON.stringify({format:'inveos_verification_kit_v1',runtime:'Python 3.11+ standard library',files:parts.map(([path,bytes])=>({path,byteLength:bytes.length,sha256:sha(bytes)})),limits:'Consistency checks only; no signature, identity, factual, legal or current-access attestation.'},null,2)+'\n');
 const bytes=storedZip([...parts,['manifest.json',manifest]]);return {bytes,sha256:sha(bytes),manifestSha256:sha(manifest),fileCount:parts.length+1};
}

type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;audit:(c:PoolClient,a:Actor,caseId:string|null,action:string,entity:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>};
export function registerVerificationKit(app:FastifyInstance,s:Services){
 let cached:ReturnType<typeof buildVerificationKit>|undefined;
 app.get('/api/verification-kit',{preHandler:s.authenticate},async(r,reply)=>{
  let kit:Awaited<ReturnType<typeof buildVerificationKit>>;
  try{cached??=buildVerificationKit();kit=await cached;}catch{cached=undefined;throw new ApiError(503,'The complete offline verification kit is unavailable.');}
  const actor=r.actor!;await inTransaction(s.pool,c=>s.audit(c,actor,null,'verification_kit.downloaded','verification_kit',actor.userId,'Static offline verification scripts supplied without case data',{sha256:kit.sha256,manifestSha256:kit.manifestSha256,fileCount:kit.fileCount}));
  return reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Content-Disposition','attachment; filename="inveos-verification-kit.zip"').header('X-INVEOS-Verifier-SHA256',kit.sha256).header('X-INVEOS-Verifier-Manifest-SHA256',kit.manifestSha256).type('application/zip').send(kit.bytes);
 });
}
