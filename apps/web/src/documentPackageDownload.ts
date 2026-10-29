const digestPattern=/^[a-f0-9]{64}$/;
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type VerifiedDocumentPackage={caseId:string;revisionId:string;reportSha256:string;packageSha256:string;verifiedAt:string};

async function sha256(bytes:ArrayBuffer|Uint8Array<ArrayBuffer>):Promise<string>{
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function fail():never{throw new Error('The document package does not match its frozen report and package fingerprints.');}
function decodeBase64(value:unknown):Uint8Array<ArrayBuffer>{
 if(typeof value!=='string'||value.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return fail();
 let binary:string;try{binary=atob(value);}catch{return fail();}if(btoa(binary)!==value)return fail();const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
}
/** Bound response allocation even when Content-Length is absent or false. */
export async function readDocumentPackageBytes(response:Response,maxBytes=64*1024*1024):Promise<ArrayBuffer>{
 if(!response.body)throw new Error('The document package download has no body.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>maxBytes)throw new Error('The document package exceeds the download size limit.');chunks.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(total===0)throw new Error('The document package download is empty.');const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}
/** Verify exact package bytes plus the embedded frozen report before offering a download. */
export async function verifyDocumentPackageDownload(bytes:ArrayBuffer,reportSha256:string,header:string|null):Promise<{packageSha256:string;documentFindings:number}>{
 if(!digestPattern.test(reportSha256)||!header||!digestPattern.test(header))return fail();
 const packageSha256=await sha256(bytes);if(packageSha256!==header)return fail();
 let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return fail();}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return fail();const value=parsed as Record<string,unknown>;
 if(Object.keys(value).sort().join(',')!=='exhibits,format,reportBase64,reportSha256'||value.format!=='inveos_document_report_package_v1'||value.reportSha256!==reportSha256||!Array.isArray(value.exhibits)||value.exhibits.length<1||value.exhibits.length>1000)return fail();
 const report=decodeBase64(value.reportBase64);if(await sha256(report)!==reportSha256)return fail();
 return {packageSha256,documentFindings:value.exhibits.length};
}
export function packageStorageKey(caseId:string,revisionId:string){return `inveos:document-package:v1:${caseId}:${revisionId}`;}
export function readVerifiedDocumentPackage(store:Pick<Storage,'getItem'>,caseId:string,revisionId:string,reportSha256:string):VerifiedDocumentPackage|null{
 if(!uuidPattern.test(caseId)||!uuidPattern.test(revisionId)||!digestPattern.test(reportSha256))return null;let value:unknown;try{const raw=store.getItem(packageStorageKey(caseId,revisionId));if(!raw)return null;value=JSON.parse(raw);}catch{return null;}
 if(!value||typeof value!=='object')return null;const row=value as Record<string,unknown>;
 if(row.caseId!==caseId||row.revisionId!==revisionId||row.reportSha256!==reportSha256||typeof row.packageSha256!=='string'||!digestPattern.test(row.packageSha256)||typeof row.verifiedAt!=='string'||!Number.isFinite(Date.parse(row.verifiedAt)))return null;
 return row as VerifiedDocumentPackage;
}
export function saveVerifiedDocumentPackage(store:Pick<Storage,'setItem'>,receipt:VerifiedDocumentPackage){
 if(!uuidPattern.test(receipt.caseId)||!uuidPattern.test(receipt.revisionId)||!digestPattern.test(receipt.reportSha256)||!digestPattern.test(receipt.packageSha256)||!Number.isFinite(Date.parse(receipt.verifiedAt)))throw new Error('The document package verification receipt is invalid.');
 store.setItem(packageStorageKey(receipt.caseId,receipt.revisionId),JSON.stringify(receipt));
}
