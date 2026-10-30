/** Bounded fixed-destination RDAP transport. No bootstrap, redirects or follow-ups. */
import {request as httpsRequest} from 'node:https';
import {request as httpRequest,type RequestOptions} from 'node:http';
import {lookup} from 'node:dns/promises';
import {CollectionFailure,publicAddress,type CollectionResponse} from './collection-transport.js';
import {researchTarget} from './research-adapters.js';
export type RdapResponse=CollectionResponse&{sourceUrl:string};
export type RdapTransport=(scope:{endpointScope:string;domain:string},signal:AbortSignal)=>Promise<RdapResponse>;
export const rdapCandidateEndpoint='https://rdap.verisign.com/com/v1/domain/';
export const rdapFixtureEndpoint='https://rdap.example.test/domain/';
// This is a code qualification gate, deliberately not an environment toggle or policy checkbox.
const liveRdapQualified=false;
const resolveAddresses=(hostname:string)=>lookup(hostname,{all:true});
async function exchange(url:URL,sourceUrl:string,signal:AbortSignal,fixture:boolean,pinned?:{address:string;family:number}):Promise<RdapResponse>{
 return new Promise((resolve,reject)=>{
  let settled=false,total=0;const chunks:Buffer[]=[];
  const finish=(error?:string,response?:RdapResponse)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){req.destroy();reject(new CollectionFailure(error));}else resolve(response!);};
  const options:RequestOptions={method:'GET',agent:false,signal,headers:{Accept:'application/rdap+json, application/json','Accept-Encoding':'identity','User-Agent':'INVEOS-bounded-RDAP/1'},...(pinned?{lookup:(_host,_options,callback)=>callback(null,pinned.address,pinned.family)}:{})};
  const req=(fixture?httpRequest:httpsRequest)(url,options,res=>{
   const status=res.statusCode??0;
   if(status>=300&&status<400)return finish('redirect_denied');
   if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity')return finish('encoded_response_denied');
   const size=res.headers['content-length'];if(size&&(!/^\d+$/.test(size)||Number(size)>262144))return finish('response_too_large');
   res.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>262144)finish('response_too_large');else chunks.push(chunk);});
   res.on('error',()=>finish('transport_failed'));res.on('aborted',()=>finish('truncated_response'));
   res.on('end',()=>{if(size&&Number(size)!==total)return finish('truncated_response');finish(undefined,{sourceUrl,provenance:fixture?'fictional_fixture':'provider',status,body:Buffer.concat(chunks),date:res.headers.date??null,etag:res.headers.etag??null,contentType:res.headers['content-type']??'',retryAfter:typeof res.headers['retry-after']==='string'?res.headers['retry-after']:null});});
  });
  const timer=setTimeout(()=>finish('transport_timeout'),10000);
  req.on('error',()=>finish(signal.aborted?'cancelled':'transport_failed'));req.end();
 });
}
export function rdapProviderTransport():RdapTransport{
 return async(scope,signal)=>{
  // Enforced before any DNS or socket operation; no policy/API can activate it.
  if(!liveRdapQualified)throw new CollectionFailure('live_collection_disabled');
  if(scope.endpointScope!==rdapCandidateEndpoint||!scope.domain.endsWith('.com'))throw new CollectionFailure('endpoint_scope_denied');
  const sourceUrl=researchTarget('rdap_domain_v1',scope.domain,scope.endpointScope),url=new URL(sourceUrl);
  const addresses=await new Promise<Awaited<ReturnType<typeof resolveAddresses>>>((resolve,reject)=>{
   const abort=()=>reject(new CollectionFailure('cancelled'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});
   const deadline=setTimeout(()=>reject(new CollectionFailure('dns_timeout')),10000);
   void resolveAddresses(url.hostname).then(resolve,()=>reject(new CollectionFailure('dns_failed'))).finally(()=>{clearTimeout(deadline);signal.removeEventListener('abort',abort);});
  });if(signal.aborted)throw new CollectionFailure('cancelled');
  if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw new CollectionFailure('destination_denied');
  return exchange(url,sourceUrl,signal,false,addresses[0]);
 };
}
/** Explicit fixture injection; cannot be passed a hostname, path or remote address. */
export function rdapLoopbackTransport(port:number):RdapTransport{
 if(!Number.isInteger(port)||port<1||port>65535)throw new CollectionFailure('fixture_port_required');
 return async(scope,signal)=>{
  if(scope.endpointScope!==rdapFixtureEndpoint||scope.domain!=='example.test')throw new CollectionFailure('fixture_scope_required');
  const sourceUrl=researchTarget('rdap_domain_v1',scope.domain,scope.endpointScope);
  return exchange(new URL(`http://127.0.0.1:${port}/domain/example.test`),sourceUrl,signal,true);
 };
}
