export interface DisclosureItem{id:string;revisionId:string;sha256:string;reportSha256:string;deliverable:'report_json'|'document_package'|'report_pdf';createdAt:string;expiresAt:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function readDisclosurePage(value:unknown):{items:DisclosureItem[];nextBefore:string|null}{
 const fail=():never=>{throw new Error('The disclosure list response is invalid. Refresh to try again.');};
 if(!value||typeof value!=='object')return fail();const page=value as Record<string,unknown>;
 if(!Array.isArray(page.items)||page.items.length>50)return fail();const seen=new Set<string>();
 const items=page.items.map((value:unknown)=>{if(!value||typeof value!=='object')return fail();const item=value as Record<string,unknown>;
  for(const key of ['id','revisionId'])if(typeof item[key]!=='string'||!uuid.test(item[key] as string))return fail();
  for(const key of ['sha256','reportSha256'])if(typeof item[key]!=='string'||!/^[a-f0-9]{64}$/.test(item[key] as string))return fail();
  if(item.deliverable!=='report_json'&&item.deliverable!=='document_package'&&item.deliverable!=='report_pdf')return fail();
  for(const key of ['createdAt','expiresAt'])if(typeof item[key]!=='string'||!Number.isFinite(Date.parse(item[key] as string)))return fail();
  const id=item.id as string;if(seen.has(id))return fail();seen.add(id);
  return {id,revisionId:item.revisionId as string,sha256:item.sha256 as string,reportSha256:item.reportSha256 as string,deliverable:item.deliverable as DisclosureItem['deliverable'],createdAt:item.createdAt as string,expiresAt:item.expiresAt as string};
 });
 if(page.nextBefore!==null&&(typeof page.nextBefore!=='string'||!uuid.test(page.nextBefore)||page.nextBefore!==items.at(-1)?.id))return fail();
 return {items,nextBefore:page.nextBefore as string|null};
}

/** Bound response allocation even when a server omits or misstates Content-Length. */
export async function readDisclosureBytes(response:Response,maxBytes=32*1024*1024):Promise<ArrayBuffer>{
 if(!response.body)throw new Error('The disclosure download has no body.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>maxBytes)throw new Error('The disclosure exceeds the download size limit.');chunks.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}
