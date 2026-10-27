import type {Evidence} from '@inveos/contracts';
import {jobRequestScope} from './jobRequest';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type BinaryInput={filename:string;contentBase64:string;expectedSha256:string;sourceTime:string;method:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join('');
export async function binaryIntakeScope(csrf:string,caseId:string){return (await jobRequestScope(csrf,caseId)).replace('job-request','binary-intake');}
export async function prepareBinary(file:Pick<File,'name'|'size'|'arrayBuffer'>,sourceTime:string,method:string):Promise<BinaryInput>{
  if(!Number.isInteger(file.size)||file.size<1||file.size>262144)throw new Error('Choose a file between 1 byte and 256 KiB.');
  if(file.name.length<5||file.name.length>128||file.name.trim()!==file.name||/[\\/\u0000-\u001f\u007f-\u009f]/u.test(file.name))throw new Error('Use a safe original filename (5–128 characters).');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(sourceTime)||!Number.isFinite(Date.parse(sourceTime))||new Date(sourceTime.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==sourceTime.slice(0,10)||method.trim().length<5||method.length>500)throw new Error('Supply the original source timestamp with timezone and an acquisition method.');
  const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw new Error('File size changed during reading.');
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return {filename:file.name,contentBase64:btoa(binary),expectedSha256:await hash(bytes),sourceTime,method};
}
export function pendingBinary(store:Store,scope:string):{key:string;fingerprint:string}|null{
  const raw=store.getItem(scope);if(raw===null)return null;
  try{const p=JSON.parse(raw);if(!p||Object.keys(p).length!==2||typeof p.key!=='string'||!uuid.test(p.key)||typeof p.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(p.fingerprint))throw Error();return p;}
  catch{throw new Error('Pending intake record is invalid. Inspect evidence history before clearing tab storage.');}
}
export async function sendBinaryRecoverably(store:Store,scope:string,caseId:string,input:BinaryInput,send:(body:BinaryInput&{idempotencyKey:string})=>Promise<unknown>):Promise<Evidence>{
  const fingerprint=await hash(new TextEncoder().encode(JSON.stringify(input)));
  let pending=pendingBinary(store,scope);
  if(pending&&pending.fingerprint!==fingerprint)throw new Error('An unconfirmed intake exists. Reselect the same file and restore the exact source timestamp and method.');
  if(!pending){pending={key:crypto.randomUUID(),fingerprint};const raw=JSON.stringify(pending);store.setItem(scope,raw);if(store.getItem(scope)!==raw)throw new Error('Retry storage unavailable. Nothing was sent.');}
  const value=await send({...input,idempotencyKey:pending.key}) as Evidence;
  if(!value||typeof value.id!=='string'||!uuid.test(value.id)||value.caseId!==caseId||value.filename!==input.filename||value.digest!==input.expectedSha256||value.bytes!==atob(input.contentBase64).length||value.sourceTime!==input.sourceTime||value.method!==input.method||value.originalKind!=='opaque_binary'||value.status!=='Quarantined'||value.text!=='')throw new Error('Original receipt could not be confirmed. Recover the pending intake.');
  if(pendingBinary(store,scope)?.key===pending.key){store.removeItem(scope);if(pendingBinary(store,scope)?.key===pending.key)throw new Error('Original saved; retry record could not be cleared. Recover its receipt.');}
  return value;
}
