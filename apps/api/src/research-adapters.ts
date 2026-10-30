import {gleifEndpoint,gleifRecordUrl,inspectGleifRecord} from './gleif-adapter.js';
/**
 * RDAP field-selection / source-event policy adaptation informed by pinned
 * OpenOSINT and SpiderFoot. MIT notices and exact revisions: third_party/osint/.
 * First-party implementation; no upstream runtime, bootstrap or linked traversal.
 */
import {isIP} from 'node:net';
import type {ResearchAdapterId,ResearchCaptureInput,ResearchReceipt} from '@inveos/contracts';
import {parseDocumentRaw} from './document-derivative.js';
import {transcriptText} from './supplied-transcript.js';
import {ApiError} from './errors.js';
export function declaredHttps(value:string):URL{
 let u:URL;try{u=new URL(value);}catch{throw new ApiError(422,'Declare a canonical HTTPS URL.');}
 if(value.length>2000||u.href!==value||u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.search||/[\s\\%]/u.test(value)||isIP(u.hostname)||!u.hostname.includes('.')||u.hostname.endsWith('.localhost')||u.hostname.endsWith('.local'))throw new ApiError(422,'Scope requires a canonical HTTPS DNS URL without credentials, query, fragment, escapes or port. No request will be sent.');
 return u;
}
export function researchEndpoint(id:ResearchAdapterId,value:string):string{
 const u=declaredHttps(value);
 if(id==='gleif_lei_v1'&&value!==gleifEndpoint)throw new ApiError(422,'GLEIF policy requires the exact registered single-record endpoint.');
 if(id==='rdap_domain_v1'&&!u.pathname.endsWith('/domain/'))throw new ApiError(422,'RDAP scope must be the exact approved HTTPS path ending /domain/.');
 if(id==='supplied_webpage_v1'&&u.pathname!=='/')throw new ApiError(422,'Webpage scope must be one exact HTTPS origin ending /.');
 return value;
}
export function researchTarget(id:ResearchAdapterId,target:string,endpoint:string):string{
 researchEndpoint(id,endpoint);
 if(id==='gleif_lei_v1')return gleifRecordUrl(target,endpoint);
 if(id==='rdap_domain_v1'){
  if(target.length>253||!target.includes('.')||isIP(target)||!target.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))||target.endsWith('.localhost')||target.endsWith('.local'))throw new ApiError(422,'Use one exact lowercase ASCII domain, without paths, wildcards or contact identifiers.');
  return endpoint+target;
 }
 const u=declaredHttps(target);if(u.origin+'/'!==endpoint)throw new ApiError(422,'The supplied page URL must be inside the independently approved exact origin.');return target;
}
function sourceInstant(value:string):number{
 const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/.exec(value);
 if(!m)return NaN;
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number) as [number,number,number,number,number,number];
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>days[month-1]!||hour>23||minute>59||second>59)return NaN;
 return Date.parse(value);
}
export function inspectResearchCapture(id:ResearchAdapterId,target:string,q:ResearchCaptureInput,now:Date):{bytes:Buffer;fields:ResearchReceipt['fields']}{
 if(q.fictional!==true)throw new ApiError(422,'Only explicitly fictional development captures are enabled.');
 const bytes=Buffer.from(q.contentBase64,'base64');
 if(!bytes.length||bytes.length>262144||bytes.toString('base64')!==q.contentBase64)throw new ApiError(422,'Supply 1–262144 original bytes with canonical base64 encoding.');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new ApiError(422,'This supplied-source profile accepts valid UTF-8 only.');}
 if(Buffer.from(text).compare(bytes)!==0||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))throw new ApiError(422,'Source text contains unsupported control bytes.');
 for(const t of [q.sourceTime,q.retrievedAt])if(!Number.isFinite(sourceInstant(t))||Date.parse(t)>now.getTime()+300000)throw new ApiError(422,'Declare source and retrieval time with explicit timezone; future times are bounded.');
 if(Date.parse(q.sourceTime)>Date.parse(q.retrievedAt)+300000)throw new ApiError(422,'Declared source time follows retrieval. Preserve uncertainty in the request reason.');
 if(!transcriptText(q.publisher,300)||!q.publisher.trim()||!transcriptText(q.filename,200)||/[\/\\]/.test(q.filename))throw new ApiError(422,'Declare a bounded publisher and filename without paths.');
 if(id==='supplied_webpage_v1'){
  if(q.captureMode!=='supplied_webpage'||q.sourceTimeBasis!=='declared_page_time'||!['text/html','text/plain'].includes(q.mediaType))throw new ApiError(422,'Use supplied-webpage mode and a declared page time for HTML or text.');
  return {bytes,fields:[]}; // Deliberately no DOM, browser, sanitizer, linked resource or inferred page time.
 }
 if(!['fictional_fixture','controlled_response'].includes(q.captureMode)||q.sourceTimeBasis!=='declared_response_date'||!(id==='gleif_lei_v1'?['application/vnd.api+json','application/json']:['application/rdap+json','application/json']).includes(q.mediaType))throw new ApiError(422,'Use explicitly supplied registry response mode and a declared response timestamp.');
 if(bytes.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])))throw new ApiError(422,'Registry JSON profiles do not accept a byte-order mark.');
 let parsed:unknown;try{parsed=parseDocumentRaw(bytes);}catch{throw new ApiError(422,'Registry response must be bounded JSON without duplicate keys.');}
 if(id==='gleif_lei_v1')return {bytes,fields:inspectGleifRecord(parsed,target)};
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new ApiError(422,'RDAP response must be an object.');
 const v=parsed as Record<string,unknown>;
 if(v.objectClassName!=='domain'||typeof v.ldhName!=='string'||v.ldhName.toLowerCase()!==target)throw new ApiError(422,'RDAP object class or domain identity differs from the authorised request.');
 const fields:ResearchReceipt['fields']=[];
 const add=(pointer:string,value:unknown)=>{if(typeof value!=='string'||!transcriptText(value,1000)||!value.trim())throw new ApiError(422,'Unsupported RDAP field value.');fields.push({pointer,value});};
 add('/objectClassName',v.objectClassName);add('/ldhName',v.ldhName);
 if(v.handle!==undefined)add('/handle',v.handle);
 if(v.status!==undefined){if(!Array.isArray(v.status)||v.status.length>50)throw new ApiError(422,'RDAP status array exceeds profile.');v.status.forEach((x,i)=>add('/status/'+i,x));}
 if(v.events!==undefined){if(!Array.isArray(v.events)||v.events.length>50)throw new ApiError(422,'RDAP event array exceeds profile.');v.events.forEach((x,i)=>{if(!x||typeof x!=='object'||Array.isArray(x))throw new ApiError(422,'Invalid RDAP event.');add('/events/'+i+'/eventAction',x.eventAction);add('/events/'+i+'/eventDate',x.eventDate);});}
 // entities, vcardArray, contacts, links, nameserver links and notices remain
 // untouched original bytes. They are never traversed, normalised or followed.
 return {bytes,fields};
}
