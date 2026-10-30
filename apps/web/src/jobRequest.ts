export const jobKinds=['original_sha256_v1','utf8_line_index_v1','native_pdf_lab_v1','pdf_raster_lab_v1','pdf_raster_lab_v2','tesseract_scan_lab_v1','tesseract_scan_lab_v2','whisper_pcm_lab_v1','tika_pdf_text_lab_v1'] as const;
export type JobKind=(typeof jobKinds)[number];
export type PendingJob={idempotencyKey:string;evidenceId:string;kind:JobKind};
export type QueueReceipt={id:string;caseId:string;evidenceId:string;kind:JobKind;status:string};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function jobRequestScope(csrf:string,caseId:string){
  if(csrf.length<16||!uuid.test(caseId))throw new Error('Processing session unavailable.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csrf));
  const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  return `inveos:job-request:v1:${hash}:${caseId}`;
}
export function pendingJob(store:Store,scope:string):PendingJob|null{
  const raw=store.getItem(scope);if(raw===null)return null;
  try{
    const p=JSON.parse(raw) as PendingJob;
    if(!p||typeof p.idempotencyKey!=='string'||!uuid.test(p.idempotencyKey)||typeof p.evidenceId!=='string'||!uuid.test(p.evidenceId)
      ||!jobKinds.includes(p.kind)||Object.keys(p).length!==3)throw new Error();
    return p;
  }catch{throw new Error('Pending processing request is invalid. Inspect job history before clearing tab storage.');}
}
/** Persist before send; an unconfirmed request owns this case's queue action until recovered. */
export async function queueRecoverably(store:Store,scope:string,caseId:string,input:{evidenceId:string;kind:JobKind},send:(p:PendingJob)=>Promise<unknown>):Promise<QueueReceipt>{
  let p=pendingJob(store,scope);
  if(!p){
    if(!uuid.test(input.evidenceId)||!jobKinds.includes(input.kind))throw new Error('Choose a supported original and processor.');
    p={idempotencyKey:crypto.randomUUID(),...input};
    const raw=JSON.stringify(p);store.setItem(scope,raw);
    if(store.getItem(scope)!==raw)throw new Error('Processing retry storage did not retain the request. Nothing was sent.');
  }
  const result=await send(p) as QueueReceipt|null;
  if(!result||typeof result.id!=='string'||!uuid.test(result.id)||result.caseId!==caseId||result.evidenceId!==p.evidenceId||result.kind!==p.kind
    ||!['queued','running','succeeded','failed','cancelled'].includes(result.status))throw new Error('Processing receipt could not be confirmed. Recover the pending request.');
  if(pendingJob(store,scope)?.idempotencyKey===p.idempotencyKey){
    store.removeItem(scope);if(pendingJob(store,scope)?.idempotencyKey===p.idempotencyKey)throw new Error('Job saved but retry storage could not be cleared. Recover its receipt.');
  }
  return result;
}
