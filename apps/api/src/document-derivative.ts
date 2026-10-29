/** First-party native-output validation. No PDF parser or upstream runtime is imported. */
import {sha256} from './text-derivative.js';

export const documentKind='native_pdf_lab_v1';
// Frozen research profile: changing any runtime/configuration requires a new version.
export const documentProfile=JSON.stringify({
  tool:'docling-slim',version:'2.142.1',revision:'90234a71b16785d08fd2f46ec62668dd2396db76',
  image:'python@sha256:623674a14ef93d052bb9b0de4dbf5f28eb578a35263838941cc8aa43213c1487',
  imageId:'37ccb536022bb36c4570856b55ebfa85bf07827e3c2fa3eba37f0dac62eebc05',
  wheelInventory:'0d0dae5ea2484d990c51c08c3b1259510a5dac96063c090cae6f1a86ce85657f',
  sourceWheel:'a3beff60a61814bcc757d71b1a042bdb06d4a4b7a969296a309b3bd5f5693fca',
  pipeline:'NativePdfPipeline',backend:'ThreadedDoclingParseDocumentBackend',threads:1,
  ocr:false,renderPages:false,includeBitmapImages:false,maxPages:2,maxOriginalBytes:65536,timeoutSeconds:20,
});
export const documentProfileDigest=sha256(documentProfile);
export type DocumentContext={tenantId:string;caseId:string;jobId:string;evidenceId:string;sourceDigest:string;authorityVersion:number};
export type DocumentResult={context:DocumentContext;profileDigest:string;successful:boolean;raw:Buffer};
function fail():never {throw new Error('Invalid native document result');}
function object(value:unknown):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))fail();return value as Record<string,unknown>;}
function number(value:unknown):number {if(typeof value!=='number'||!Number.isFinite(value))fail();return value;}

/** Reject duplicate keys (including escaped aliases), excessive nesting and malformed UTF-8. */
function parseRaw(raw:Buffer):unknown {
  if(!raw.length||raw.length>1048576)fail();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  // JSON.parse checks grammar; the token pass records object keys without interpreting values.
  const parsed:unknown=JSON.parse(text);
  const stack:({keys:Set<string>;key:boolean}|null)[]=[];
  const tokens=text.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:]+/g)??[];
  for(const token of tokens){
    const top=stack.at(-1);
    if(token==='{'||token==='['){stack.push(token==='{'?{keys:new Set(),key:true}:null);if(stack.length>64)fail();}
    else if(token==='}'||token===']')stack.pop();
    else if(token===','){if(top)top.key=true;}
    else if(token===':'){if(top)top.key=false;}
    else if(top?.key&&token.startsWith('"')){const key=JSON.parse(token) as string;if(top.keys.has(key))fail();top.keys.add(key);}
  }
  return parsed;
}

export function makeDocumentDerivative(original:Buffer, context:DocumentContext, result:DocumentResult) {
  if(!original.length||original.length>65536||!original.subarray(0,5).equals(Buffer.from('%PDF-'))||sha256(original)!==context.sourceDigest)fail();
  if(result.successful!==true||result.profileDigest!==documentProfileDigest)fail();
  for(const key of ['tenantId','caseId','jobId','evidenceId','sourceDigest','authorityVersion'] as const)if(result.context[key]!==context[key])fail();
  const data=object(parseRaw(result.raw));
  if(data.schema_name!=='DoclingDocument')fail();
  const pages=object(data.pages),keys=Object.keys(pages);
  if(keys.length<1||keys.length>2)fail();
  const dimensions=keys.map((_,index)=>{
    const page=object(pages[String(index+1)]),size=object(page.size);
    if(page.page_no!==index+1)fail();
    const width=number(size.width),height=number(size.height);if(width<=0||height<=0)fail();
    return {page:index+1,width,height};
  });
  if(!Array.isArray(data.texts)||data.texts.length>1000)fail();
  // This native-text profile has no table/structured-content support. Never silently drop it.
  for(const key of ['tables','key_value_items'])if(data[key]!==undefined&&(!Array.isArray(data[key])||(data[key] as unknown[]).length))fail();
  let text='',offset=0;const counts=dimensions.map(()=>0),seen=new Set<string>();
  const references=data.texts.map((value,index)=>{
    const item=object(value);
    if(typeof item.text!=='string'||!item.text.length||typeof item.self_ref!=='string'||item.self_ref!==`#/texts/${index}`||seen.has(item.self_ref))fail();
    if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item.text))fail();
    seen.add(item.self_ref);
    if(!Array.isArray(item.prov)||item.prov.length!==1)fail();
    const prov=object(item.prov[0]),page=number(prov.page_no);
    if(!Number.isInteger(page)||page<1||page>dimensions.length||!Array.isArray(prov.charspan)||prov.charspan.length!==2||prov.charspan[0]!==0||prov.charspan[1]!==Array.from(item.text).length)fail();
    const box=object(prov.bbox),l=number(box.l),r=number(box.r),b=number(box.b),t=number(box.t),origin=box.coord_origin;
    if(!['TOPLEFT','BOTTOMLEFT'].includes(String(origin))||l<0||r<=l||r>dimensions[page-1]!.width||Math.min(b,t)<0||Math.max(b,t)>dimensions[page-1]!.height||b===t||(origin==='BOTTOMLEFT'?b>t:t>b))fail();
    if(index){text+='\n';offset++;}const startByte=offset;text+=item.text;offset+=Buffer.byteLength(item.text);if(offset>1048576)fail();counts[page-1]=(counts[page-1]??0)+1;
    return {itemRef:item.self_ref,page,bbox:{l,r,b,t,origin},startByte,endByte:offset};
  });
  const pagesWithoutText=counts.flatMap((count,index)=>count?[]:[index+1]);
  const derivative={format:'inveos_native_document_v1',context,profileDigest:documentProfileDigest,
    rawDigest:sha256(result.raw),reviewState:'unreviewed',offsetBasis:'extracted_utf8_not_original_pdf',
    pages:dimensions,text,references,coverage:{pageTextCounts:counts,pagesWithoutText,
      disposition:pagesWithoutText.length?'needs_page_review':'unreviewed_text',completeExtractionVerified:false}};
  const bytes=Buffer.from(JSON.stringify(derivative));if(bytes.length>1048576)fail();
  return {derivative,bytes,digest:sha256(bytes),rawDigest:sha256(result.raw)};
}
