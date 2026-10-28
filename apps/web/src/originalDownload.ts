import type {Evidence} from '@inveos/contracts';
/** Validate bounded original bytes before a browser download, never a preview. */
export async function readOriginalDownload(response:Response,evidence:Pick<Evidence,'bytes'|'digest'|'originalKind'|'status'>):Promise<ArrayBuffer>{
 if(!response.ok){await response.body?.cancel();throw new Error('Original download denied or unavailable.');}
 const fail=async(message:string):Promise<never>=>{await response.body?.cancel();throw new Error(message);};
 if(!Number.isInteger(evidence.bytes)||evidence.bytes<1||evidence.bytes>262144||!/^[a-f0-9]{64}$/.test(evidence.digest))return fail('Invalid original receipt.');
 const binary=evidence.originalKind==='opaque_binary',expectedState=binary?'Quarantined':'Verified';
 if(!['opaque_binary','original_utf8'].includes(evidence.originalKind||'')||evidence.status!==expectedState||response.headers.get('x-inveos-original-state')!==expectedState||response.headers.get('content-type')?.split(';')[0]!== (binary?'application/octet-stream':'text/plain'))return fail('Original download state mismatch.');
 const length=response.headers.get('content-length');if(length!==null&&length!==String(evidence.bytes))return fail('Original download length mismatch.');
 if(!response.body)throw new Error('Original download has no body.');
 const reader=response.body.getReader(),bytes=new Uint8Array(evidence.bytes);let offset=0;
 try{while(true){const part=await reader.read();if(part.done)break;if(offset+part.value.length>bytes.length)throw new Error('Original download exceeds its receipt size.');bytes.set(part.value,offset);offset+=part.value.length;}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(offset!==bytes.length)throw new Error('Original download is incomplete.');
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==evidence.digest)throw new Error('Original download fingerprint mismatch.');
 return bytes.buffer;
}
