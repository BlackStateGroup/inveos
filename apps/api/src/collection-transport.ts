/** Fixed-host, bounded first-party transport. No redirect, arbitrary URL or ambient proxy. */
import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {companyProfileConnector,companyProfileUrl} from './connector-policy.js';
export type CollectionResponse={provenance:'fictional_fixture'|'provider';status:number;body:Buffer;date:string|null;etag:string|null;contentType:string;retryAfter:string|null};
export type CollectionTransport=(companyNumber:string,signal:AbortSignal)=>Promise<CollectionResponse>;
export class CollectionFailure extends Error{constructor(public readonly code:string){super(code);}}
export function publicAddress(address:string):boolean{
 // Only globally routed IPv4 or 2000::/3 IPv6; deny special-use, mapped and transition forms.
 if(isIP(address)===4){const [a,b,c]=address.split('.').map(Number) as [number,number,number,number];return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
 return isIP(address)===6&&/^[23][0-9a-f]{3}:/i.test(address)&&!/^200[12]:/i.test(address);
}
const resolveAll=(hostname:string)=>lookup(hostname,{all:true});
export function companiesHouseTransport(apiKey:string):CollectionTransport{
 if(!/^[\x21-\x7e]{16,256}$/.test(apiKey)||apiKey.includes(':'))throw new CollectionFailure('credential_configuration');
 return async(number,signal)=>{
  const url=new URL(companyProfileUrl(number));
  const addresses=await new Promise<Awaited<ReturnType<typeof resolveAll>>>((resolve,reject)=>{
   const abort=()=>reject(new CollectionFailure('cancelled'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});
   void resolveAll(url.hostname).then(resolve,()=>reject(new CollectionFailure('dns_failed'))).finally(()=>signal.removeEventListener('abort',abort));
  });
  if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw new CollectionFailure('destination_denied');
  if(signal.aborted)throw new CollectionFailure('cancelled');
  const pinned=addresses[0]!;
  return new Promise((resolve,reject)=>{
   let settled=false,total=0;const chunks:Buffer[]=[];
   const fail=(code:string)=>{if(settled)return;settled=true;req.destroy();reject(new CollectionFailure(code));};
   const req=request(url,{method:'GET',agent:false,signal,lookup:(_hostname,_options,cb)=>cb(null,pinned.address,pinned.family),headers:{Authorization:'Basic '+Buffer.from(apiKey+':').toString('base64'),Accept:'application/json','Accept-Encoding':'identity','User-Agent':'INVEOS-source-capture/1'}},res=>{
    const status=res.statusCode??0;
    if(status>=300&&status<400)return fail('redirect_denied');
    if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity')return fail('encoded_response_denied');
    const size=res.headers['content-length'];if(size&&(!/^\d+$/.test(size)||Number(size)>companyProfileConnector.maxResponseBytes))return fail('response_too_large');
    res.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>companyProfileConnector.maxResponseBytes)fail('response_too_large');else chunks.push(chunk);});
    res.on('error',()=>fail('transport_failed'));
    res.on('aborted',()=>fail('truncated_response'));
    res.on('end',()=>{if(settled)return;if(size&&Number(size)!==total)return fail('truncated_response');settled=true;resolve({provenance:'provider',status,body:Buffer.concat(chunks),date:res.headers.date??null,etag:res.headers.etag??null,contentType:res.headers['content-type']??'',retryAfter:typeof res.headers['retry-after']==='string'?res.headers['retry-after']:null});});
   });
   req.setTimeout(companyProfileConnector.deadlineMs,()=>fail('transport_timeout'));
   req.on('error',()=>fail(signal.aborted?'cancelled':'transport_failed'));req.end();
  });
 };
}
