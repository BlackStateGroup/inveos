import type {InspectedDocument} from './documentInspection';
import {jobRequestScope} from './jobRequest';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type PendingCitation={id:string;itemRef:string;derivativeDigest:string};
export type CitationReceipt={id:string;createdBy:string;createdAt:string;citationDigest:string;citation:{format:string;context:{tenantId:string;caseId:string;jobId:string;evidenceId:string;sourceDigest:string;authorityVersion:number};derivativeDigest:string;rawDigest:string;profileDigest:string;status:string;offsetBasis:string;itemRef:string;page:number;bbox:InspectedDocument['references'][number]['bbox'];startByte:number;endByte:number;quote:string}};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=():never=>{throw new Error('Citation receipt or retry identity could not be verified. Refresh and recover the pending request.');};
export async function citationScope(csrf:string,d:InspectedDocument){return `${await jobRequestScope(csrf,d.caseId)}:citation:${d.jobId}`;}
export function pendingCitation(store:Store,scope:string):PendingCitation|null{
  const raw=store.getItem(scope);if(raw===null)return null;
  try{const p=JSON.parse(raw) as PendingCitation;if(!p||!uuid.test(p.id)||!/^#\/texts\/[0-9]{1,4}$/.test(p.itemRef)||!/^[a-f0-9]{64}$/.test(p.derivativeDigest)||Object.keys(p).length!==3)fail();return p;}catch{return fail();}
}
export function wholePassage(d:InspectedDocument,itemRef:string){
  const ref=d.references.find(r=>r.itemRef===itemRef);if(!ref||!ref.text||new TextEncoder().encode(ref.text).length>4096)throw new Error('Choose a non-empty passage of at most 4096 UTF-8 bytes.');
  return {derivativeDigest:d.derivativeDigest,itemRef:ref.itemRef,startByte:ref.startByte,endByte:ref.endByte,quote:ref.text};
}
/** Rebuild the exact selected occurrence from verified extraction; never match by quote alone. */
export async function verifyCitation(value:unknown,d:InspectedDocument,expectedId?:string):Promise<CitationReceipt>{
  const row=value as CitationReceipt|null;if(!row||!uuid.test(row.id)||expectedId&&row.id!==expectedId||!uuid.test(row.createdBy)||!Number.isFinite(Date.parse(row.createdAt)))fail();
  const c=row!.citation,ref=d.references.find(r=>r.itemRef===c?.itemRef);
  if(!c||!ref||!c.context||!uuid.test(c.context.tenantId)||!Number.isInteger(c.startByte)||!Number.isInteger(c.endByte)||c.startByte<ref.startByte||c.endByte>ref.endByte||c.endByte<=c.startByte)fail();
  const bytes=new TextEncoder().encode(ref!.text),decode=new TextDecoder('utf-8',{fatal:true});
  decode.decode(bytes.subarray(0,c.startByte-ref!.startByte));
  const quote=decode.decode(bytes.subarray(c.startByte-ref!.startByte,c.endByte-ref!.startByte));if(new TextEncoder().encode(quote).length>4096)fail();
  const expected={format:'inveos_document_citation_candidate_v1',context:{tenantId:c.context.tenantId,caseId:d.caseId,jobId:d.jobId,evidenceId:d.evidenceId,sourceDigest:d.sourceDigest,authorityVersion:d.authorityVersion},derivativeDigest:d.derivativeDigest,rawDigest:d.rawDigest,profileDigest:d.profileDigest,status:'unreviewed_candidate',offsetBasis:'extracted_utf8_not_original_pdf',itemRef:ref!.itemRef,page:ref!.page,bbox:ref!.bbox,startByte:c.startByte,endByte:c.endByte,quote};
  if(JSON.stringify(c)!==JSON.stringify(expected))fail();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(expected)))),b=>b.toString(16).padStart(2,'0')).join('');
  if(row!.citationDigest!==digest)fail();return row!;
}
export async function saveCitationRecoverably(store:Store,scope:string,d:InspectedDocument,itemRef:string,send:(p:PendingCitation,selection:ReturnType<typeof wholePassage>)=>Promise<unknown>){
  let p=pendingCitation(store,scope);
  if(!p){wholePassage(d,itemRef);p={id:crypto.randomUUID(),itemRef,derivativeDigest:d.derivativeDigest};const raw=JSON.stringify(p);store.setItem(scope,raw);if(store.getItem(scope)!==raw)throw new Error('Retry storage unavailable. Nothing was sent.');}
  if(p.derivativeDigest!==d.derivativeDigest)fail();
  const selection=wholePassage(d,p.itemRef),receipt=await verifyCitation(await send(p,selection),d,p.id);
  if(receipt.citation.itemRef!==p.itemRef||receipt.citation.startByte!==selection.startByte||receipt.citation.endByte!==selection.endByte)fail();
  if(pendingCitation(store,scope)?.id===p.id){store.removeItem(scope);if(pendingCitation(store,scope)?.id===p.id)throw new Error('Candidate saved; recover its receipt to clear retry storage.');}
  return receipt;
}
