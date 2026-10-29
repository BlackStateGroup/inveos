import type {InspectionJob} from './derivativeInspection';
export type Reference={itemRef:string;page:number;startByte:number;endByte:number;bbox:{l:number;r:number;b:number;t:number;origin:string}};
export type InspectedDocument={jobId:string;evidenceId:string;sourceDigest:string;derivativeDigest:string;rawDigest:string;profileDigest:string;processedAt:string;authorityVersion:number;pageCount:number;pages:{page:number;width:number;height:number}[];pagesWithoutText:number[];references:(Reference&{text:string})[]};
const fail=():never=>{throw new Error('Document derivative identity or ranges could not be verified. Refresh processing history and retry.');};
const hex=/^[a-f0-9]{64}$/;
async function sha(value:string){const bytes=new TextEncoder().encode(value);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
/** Validate the selected receipt before display. Server revalidates raw output against the original. */
export async function inspectDocumentDerivative(value:unknown,job:InspectionJob):Promise<InspectedDocument>{
  if(!value||typeof value!=='object')fail();
  const row=value as InspectedDocument&{caseId:string;status:string;profile:unknown;derivative:{format:string;context:{jobId:string;caseId:string;evidenceId:string;sourceDigest:string;authorityVersion:number};reviewState:string;offsetBasis:string;rawDigest:string;profileDigest:string;text:string;pages:{page:number;width:number;height:number}[];references:Reference[];coverage:{completeExtractionVerified:boolean;pageTextCounts:number[];pagesWithoutText:number[];disposition:string}}};
  if(job.kind!=='native_pdf_lab_v1'||job.status!=='succeeded'||row.status!=='unreviewed_derivative'||row.jobId!==job.id||row.caseId!==job.caseId||row.evidenceId!==job.evidenceId||row.sourceDigest!==job.sourceDigest||row.authorityVersion!==job.authorityVersion)fail();
  for(const digest of [row.sourceDigest,row.derivativeDigest,row.rawDigest,row.profileDigest])if(typeof digest!=='string'||!hex.test(digest))fail();
  if(typeof row.processedAt!=='string'||!Number.isFinite(Date.parse(row.processedAt)))fail();
  const d=row.derivative;if(!d||d.format!=='inveos_native_document_v1'||d.reviewState!=='unreviewed'||d.offsetBasis!=='extracted_utf8_not_original_pdf'||d.rawDigest!==row.rawDigest||d.profileDigest!==row.profileDigest||!d.context||!d.coverage||d.coverage.completeExtractionVerified!==false)fail();
  for(const key of ['jobId','caseId','evidenceId','sourceDigest','authorityVersion'] as const)if(d.context[key]!==row[key])fail();
  if(!Array.isArray(d.pages)||d.pages.length<1||d.pages.length>2||!Array.isArray(d.references)||d.references.length>1000||typeof d.text!=='string'||d.text.length>1048576)fail();
  if(await sha(JSON.stringify(d))!==row.derivativeDigest||await sha(JSON.stringify(row.profile))!==row.profileDigest)fail();
  const bytes=new TextEncoder().encode(d.text),decoder=new TextDecoder('utf-8',{fatal:true});if(bytes.length>1048576||decoder.decode(bytes)!==d.text)fail();
  d.pages.forEach((p,i)=>{if(p.page!==i+1||![p.width,p.height].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))fail();});
  const counts=d.pages.map(()=>0);let offset=0;
  const references=d.references.map((ref,i)=>{
    if(ref.itemRef!==`#/texts/${i}`||!Number.isInteger(ref.page)||!d.pages[ref.page-1]||!Number.isInteger(ref.startByte)||!Number.isInteger(ref.endByte)||ref.startByte!==(i?offset+1:0)||ref.endByte<=ref.startByte||ref.endByte>bytes.length||i&&bytes[offset]!==10)fail();
    const p=d.pages[ref.page-1]!,b=ref.bbox;if(!b||![b.l,b.r,b.b,b.t].every(n=>typeof n==='number'&&Number.isFinite(n))||b.l<0||b.r<=b.l||b.r>p.width||Math.min(b.b,b.t)<0||Math.max(b.b,b.t)>p.height||!['TOPLEFT','BOTTOMLEFT'].includes(b.origin)||(b.origin==='TOPLEFT'?b.t>=b.b:b.b>=b.t))fail();
    counts[ref.page-1]=(counts[ref.page-1]??0)+1;offset=ref.endByte;
    return {...ref,text:decoder.decode(bytes.subarray(ref.startByte,ref.endByte))};
  });
  const missing=counts.flatMap((n,i)=>n?[]:[i+1]);
  if(offset!==bytes.length||JSON.stringify(counts)!==JSON.stringify(d.coverage.pageTextCounts)||JSON.stringify(missing)!==JSON.stringify(d.coverage.pagesWithoutText)||d.coverage.disposition!==(missing.length?'needs_page_review':'unreviewed_text'))fail();
  return {jobId:row.jobId,evidenceId:row.evidenceId,sourceDigest:row.sourceDigest,derivativeDigest:row.derivativeDigest,rawDigest:row.rawDigest,profileDigest:row.profileDigest,processedAt:row.processedAt,authorityVersion:row.authorityVersion,pageCount:d.pages.length,pages:d.pages.map(p=>({...p})),pagesWithoutText:missing,references};
}
