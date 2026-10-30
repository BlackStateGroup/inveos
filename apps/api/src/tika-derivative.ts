/** Validate bounded output from the actual locked Tika PDF wrapper; never parse PDFs here. */
import type {TikaContext,TikaDerivative,TikaPage,TikaSelection,TikaCitation,TikaRuntime} from '@inveos/contracts';
import {parseDocumentRaw} from './document-derivative.js';
import {sha256} from './text-derivative.js';
import {transcriptHash} from './transcript-findings.js';
export const tikaKind='tika_pdf_text_lab_v1';
export const tikaProfile=JSON.stringify({kind:tikaKind,tool:'apache-tika-reduced-pdf',sourceRevision:'f45b9498f35d55445af28737407586362b2e37fc',version:'4.2.1-SNAPSHOT',image:'eclipse-temurin@sha256:1d4fdea2c842d8830bfb34fe4f0faf9bdad8432f79c7d1a117f1f3ee4ad46e5b',imageId:'sha256:afe7545835fa902a51fb04410ff9834250b314666516dbdef649942dd6ab0034',runtimeLockSha256:'7dd4b380c2deed19c9086f8b398df2b2fc13fe7a92c53af5b9172a8e1e12b581',compiledJarSha256:'9979f7381d200e057f5394e4de3a437932b7bdc7a59acdd98e11511d9adf4258',wrapperSha256:'8b9e117ebca5a6627770cca0215706e05db35f494b269cd9e474e6f50eb2893c',media:['application/pdf'],maxOriginalBytes:2097152,maxPages:16,maxRawBytes:1048576,maxXhtmlBytes:524288,maxPageTextBytes:262144,deadlineSeconds:90,ocr:false,embedded:false,actions:false,annotations:false,bookmarks:false,forms:false,encrypted:false,requireExtractPermission:true,normalisation:'collapse_XML_whitespace_per_actual_XHTML_page',location:'tika_pdf_page_text',researchOnly:true});
export const tikaProfileDigest=sha256(tikaProfile);
export type TikaResult={context:TikaContext;profileDigest:string;raw:Buffer;runtime:TikaRuntime};
function invalid():never{throw new Error('Invalid bounded Tika result');}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))invalid();return v as Record<string,unknown>;}
function xmlText(s:string):string{
 if(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(s))invalid();
 return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,(_,v:string)=>{
  if(!v.startsWith('#'))return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[v]!;
  const code=v[1]==='x'?parseInt(v.slice(2),16):Number(v.slice(1));if(!Number.isInteger(code)||!(code===9||code===10||code===13||code>=32&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)&&code!==0xfffe&&code!==0xffff))invalid();return String.fromCodePoint(code);
 });
}
/** Narrow inert XML reader. No DTD/entity expansion, external resolver, HTML or DOM. */
export function tikaPages(bytes:Buffer,count:number):TikaPage[]{
 if(!bytes.length||bytes.length>524288||!Number.isInteger(count)||count<1||count>16)invalid();
 let xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml))invalid();
 xml=xml.replace(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*/,'');
 const stack:string[]=[],pages:string[][]=[];let pageDepth=0,seenRoot=false,seenBody=false,closedRoot=false,position=0,tokens=0;
 while(position<xml.length){
  if(++tokens>100000)invalid();
  if(xml[position]!=='<'){
   const end=xml.indexOf('<',position),next=end<0?xml.length:end,text=xmlText(xml.slice(position,next));
   if(pageDepth)pages.at(-1)!.push(text);else if((!stack.length||stack.includes('body'))&&text.trim())invalid();position=next;continue;
  }
  const close=/^<\/([a-z][a-z0-9]*)\s*>/.exec(xml.slice(position));
  if(close){if(stack.pop()!==close[1])invalid();if(pageDepth&&stack.length<pageDepth)pageDepth=0;if(!stack.length)closedRoot=true;position+=close[0].length;continue;}
  const open=/^<([a-z][a-z0-9]*)((?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*\s*=\s*"[^"<]*")*)\s*(\/?)>/.exec(xml.slice(position));
  if(!open||closedRoot)invalid();const tag=open[1]!,attributes:Record<string,string>={};
  for(const match of open[2]!.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"<]*)"/g)){if(Object.hasOwn(attributes,match[1]!))invalid();attributes[match[1]!]=xmlText(match[2]!);}
  if(!seenRoot){if(tag!=='html'||attributes.xmlns!=='http://www.w3.org/1999/xhtml'||open[3])invalid();seenRoot=true;}
  else if(tag==='html'||attributes.xmlns!==undefined||Object.keys(attributes).some(k=>k.startsWith('xmlns:')))invalid();
  if(tag==='body'){if(seenBody||stack.join('/')!=='html')invalid();seenBody=true;}
  if(tag==='div'&&attributes.class==='page'){
   if(pageDepth||stack.join('/')!=='html/body'||pages.length>=count||open[3])invalid();pages.push([]);pageDepth=stack.length+1;
  }
  if(!open[3]){stack.push(tag);if(stack.length>64)invalid();}position+=open[0].length;
 }
 if(stack.length||!seenRoot||!seenBody||!closedRoot||pages.length!==count)invalid();
 return pages.map((parts,i)=>{const text=parts.join('').replace(/[ \t\r\n]+/g,' ').replace(/^ | $/g,''),utf8Bytes=Buffer.byteLength(text);if(utf8Bytes>262144)invalid();return {page:i+1,path:`/html/body/div[@class="page"][${i+1}]`,text,textSha256:sha256(text),utf8Bytes,textPresent:!!text};});
}
export function makeTikaDerivative(original:Buffer,context:TikaContext,result:TikaResult){
 if(original.length<8||original.length>2097152||!original.subarray(0,5).equals(Buffer.from('%PDF-'))||sha256(original)!==context.sourceDigest||result.profileDigest!==tikaProfileDigest)invalid();
 for(const k of ['tenantId','caseId','jobId','evidenceId','sourceDigest','authorityVersion'] as const)if(context[k]!==result.context[k])invalid();
 const runtime=object(result.runtime),q=object(runtime.qualification),prepared=object(runtime.preparation),profile=JSON.parse(tikaProfile);
 const resources=object(q.resourceEvidence);
 if(Object.keys(runtime).sort().join(',')!=='preparation,qualification'||Buffer.byteLength(JSON.stringify(runtime))>32768||q.status!=='host_probe_passed'||q.profile!=='runtime-1g'||q.imageId!==profile.imageId||q.runtimeLockSha256!==profile.runtimeLockSha256||q.parserExecuted!==false||q.daemonLogging!==false||!Array.isArray(q.repoDigests)||!q.repoDigests.includes(profile.image)||!Array.isArray(q.checks)||!['boundaries','timeout','stdout_limit','stderr_limit','memory','pids','cpu'].every(k=>(q.checks as unknown[]).includes(k))||resources.oomKilled!==true||!Number.isSafeInteger(resources.pids)||Number(resources.pids)<=0||!Number.isSafeInteger(resources.cpu)||Number(resources.cpu)<=0||typeof q.checkedAt!=='string'||!Number.isFinite(Date.parse(q.checkedAt))||prepared.status!=='verified_locked_tika_bundle'||prepared.parserExecuted!==false||['compiledJarSha256','runtimeLockSha256','wrapperSha256','sourceRevision'].some(k=>prepared[k]!==profile[k]))invalid();
 const r=object(parseDocumentRaw(result.raw));
 if(Object.keys(r).sort().join(',')!=='format,metadata,parseNanos,peakRssKiB,processCpuNanos,sourceSha256,state,xhtmlBase64,xhtmlSha256'||r.format!=='inveos_tika_research_probe_v1'||r.state!=='unreviewed_research_derivative'||r.sourceSha256!==context.sourceDigest||typeof r.xhtmlBase64!=='string')invalid();
 const metadata=object(r.metadata);if(Object.keys(metadata).length>1000||Buffer.byteLength(JSON.stringify(metadata))>262144)invalid();
 for(const [key,values] of Object.entries(metadata))if(key.length>1000||!Array.isArray(values)||values.length>1000||values.some(v=>typeof v!=='string'||v.length>262144))invalid();
 const single=(key:string)=>{const v=metadata[key];if(!Array.isArray(v)||v.length!==1||typeof v[0]!=='string')invalid();return v[0] as string;};
 const pageCount=single('xmpTPg:NPages');if(!/^(?:[1-9]|1[0-6])$/.test(pageCount)||single('pdf:ocr-page-count')!=='0'||single('pdf:encrypted')!=='false'||single('access-permission:extract-content')!=='true')invalid();
 const xhtml=Buffer.from(r.xhtmlBase64,'base64');if(xhtml.toString('base64')!==r.xhtmlBase64||sha256(xhtml)!==r.xhtmlSha256)invalid();
 for(const k of ['parseNanos','processCpuNanos','peakRssKiB'])if(!Number.isSafeInteger(r[k])||Number(r[k])<0)invalid();if(Number(r.peakRssKiB)<1)invalid();
 const pages=tikaPages(xhtml,Number(pageCount)),rawDigest=sha256(result.raw);
 const derivative:TikaDerivative={format:'inveos.tika_page_text.v1',context,profileDigest:tikaProfileDigest,rawDigest,xhtmlDigest:sha256(xhtml),runtimeDigest:transcriptHash(runtime),state:'unreviewed_extraction',offsetBasis:'tika_xhtml_page_utf8_not_original_bytes',pages,coverage:{pagesWithoutText:pages.filter(p=>!p.textPresent).map(p=>p.page),completeExtractionVerified:false},metrics:{parseNanos:Number(r.parseNanos),processCpuNanos:Number(r.processCpuNanos),peakRssKiB:Number(r.peakRssKiB)}};
 const bytes=Buffer.from(JSON.stringify(derivative));if(bytes.length>1048576)invalid();return {derivative,bytes,digest:sha256(bytes),rawDigest};
}
export function tikaCitation(output:ReturnType<typeof makeTikaDerivative>,s:TikaSelection){
 const d=output.derivative,page=d.pages.find(p=>p.page===s.page);if(!page||s.derivativeDigest!==output.digest||!Number.isInteger(s.startByte)||!Number.isInteger(s.endByte)||s.startByte<0||s.endByte<=s.startByte||s.endByte>page.utf8Bytes||typeof s.quote!=='string'||!s.quote.trim()||Buffer.byteLength(s.quote)>4096)invalid();
 const text=Buffer.from(page.text),decode=new TextDecoder('utf-8',{fatal:true});decode.decode(text.subarray(0,s.startByte));if(decode.decode(text.subarray(s.startByte,s.endByte))!==s.quote)invalid();
 const citation:TikaCitation={format:'inveos.tika_page_citation.v1',context:d.context,profileDigest:d.profileDigest,rawDigest:d.rawDigest,xhtmlDigest:d.xhtmlDigest,derivativeDigest:output.digest,location:{kind:'tika_pdf_page_text',page:s.page,path:page.path,pageTextSha256:page.textSha256,startByte:s.startByte,endByte:s.endByte,offsetBasis:d.offsetBasis},quote:s.quote,state:'unreviewed_candidate'};
 return citation;
}
