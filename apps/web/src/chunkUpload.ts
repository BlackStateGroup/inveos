import {pendingBinary,type BinaryInput} from './binaryIntake';
export function binaryUploadRoute(store:Pick<Storage,'getItem'>,oldScope:string){const legacy=!!pendingBinary({getItem:k=>store.getItem(k),setItem:()=>{},removeItem:()=>{}},oldScope);return {legacy,scope:legacy?oldScope:oldScope+':chunks-v1'};}
export type UploadTransport=(path:string,body?:unknown)=>Promise<unknown>;
export type UploadProgress={id:string;receivedBytes:number;totalBytes:number;expiresAt:string};
type Reservation={id:string;caseId:string;status:'open'|'completed'|'cancelled';byteLength:number;chunkSize:number;authorityVersion:number;expiresAt:string;evidenceId:string|null;received?:number[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Each call resolves the same reservation key, then asks the server which ranges remain. */
export async function uploadBinaryChunks(caseId:string,input:BinaryInput&{idempotencyKey:string},send:UploadTransport,progress?:(p:UploadProgress)=>void,signal?:AbortSignal):Promise<unknown>{
 const checkStop=()=>{if(signal?.aborted)throw new Error('Transfer stopped. Reselect the original and retry to resume.');};
 checkStop();
 const raw=atob(input.contentBase64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(!uuid.test(caseId)||!uuid.test(input.idempotencyKey)||bytes.length<1||bytes.length>262144||btoa(raw)!==input.contentBase64)throw new Error('Invalid bounded upload.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==input.expectedSha256)throw new Error('Selected original fingerprint does not match its bytes.');
 const count=Math.ceil(bytes.length/32768),base=`/api/cases/${caseId}/uploads`;
 function validate(value:unknown,id?:string,ranges=false):Reservation{
  const r=value as Reservation;
  if(!r||!uuid.test(r.id)||r.caseId!==caseId||(id&&r.id!==id)||r.byteLength!==bytes.length||r.chunkSize!==32768||!Number.isInteger(r.authorityVersion)||r.authorityVersion<1||typeof r.expiresAt!=='string'||!Number.isFinite(Date.parse(r.expiresAt))||!['open','completed','cancelled'].includes(r.status)||(r.status==='completed'?!r.evidenceId||!uuid.test(r.evidenceId):r.evidenceId!==null))throw new Error('Upload reservation receipt mismatch.');
  if(id&&(r.authorityVersion!==reserved.authorityVersion||r.expiresAt!==reserved.expiresAt))throw new Error('Upload provenance changed.');
  if(ranges&&(!Array.isArray(r.received)||r.received.length>count||new Set(r.received).size!==r.received.length||r.received.some(n=>!Number.isInteger(n)||n<0||n>=count)))throw new Error('Invalid received upload ranges.');
  return r;
 }
 const {contentBase64:_,...metadata}=input;void _;
 const reserved=validate(await send(base,{...metadata,byteLength:bytes.length}));checkStop();
 const url=`${base}/${reserved.id}`;
 let state=validate(await send(url),reserved.id,true);checkStop();
 const report=()=>progress?.({id:state.id,receivedBytes:state.status==='completed'?bytes.length:state.received!.reduce((sum,n)=>sum+Math.min(32768,bytes.length-n*32768),0),totalBytes:bytes.length,expiresAt:state.expiresAt});
 report();
 if(state.status==='cancelled')throw new Error('Upload was cancelled. Inspect its history before starting a new intake.');
 if(state.status==='open'){
  for(let n=0;n<count;n++){
   checkStop();if(state.received!.includes(n))continue;
   let chunk='';for(const b of bytes.subarray(n*32768,Math.min(bytes.length,(n+1)*32768)))chunk+=String.fromCharCode(b);
   const next=validate(await send(url+'/chunk',{ordinal:n,contentBase64:btoa(chunk)}),reserved.id,true);
   if(next.status!=='open'||!next.received!.includes(n)||state.received!.some(i=>!next.received!.includes(i)))throw new Error('Chunk acknowledgement mismatch. Retry to reconcile server state.');
   state=next;report();
  }
 }
 checkStop();return send(url+'/complete',{});
}
