import type {InspectionJob} from './derivativeInspection';
export type RasterPage={page:number;width:number;height:number;byteLength:number;digest:string};
export type InspectedRaster={job:InspectionJob;processedAt:string;derivativeDigest:string;profileDigest:string;pages:RasterPage[]};
const fail=():never=>{throw new Error('Raster identity or page bytes could not be verified. Refresh processing history and retry.');};
const hex=/^[a-f0-9]{64}$/;
async function hash(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');}
const jsonHash=(value:unknown)=>hash(new TextEncoder().encode(JSON.stringify(value)));
export async function inspectRaster(value:unknown,job:InspectionJob):Promise<InspectedRaster>{
  if(!value||typeof value!=='object')fail();
  const r=value as {jobId:string;caseId:string;evidenceId:string;sourceDigest:string;authorityVersion:number;status:string;processedAt:string;derivativeDigest:string;profileDigest:string;profile:{format:string;scale:number;rotation:number;crop:number[];grayscale:boolean;forms:boolean;annotations:boolean};manifest:{format:string;context:Record<string,unknown>;profileDigest:string;reviewState:string;coordinates:string;limitations:string[];pages:RasterPage[]}};
  if(job.kind!=='pdf_raster_lab_v1'||job.status!=='succeeded'||r.status!=='unreviewed_derivative'||r.jobId!==job.id||r.caseId!==job.caseId||r.evidenceId!==job.evidenceId||r.sourceDigest!==job.sourceDigest||r.authorityVersion!==job.authorityVersion)fail();
  if(![r.sourceDigest,r.derivativeDigest,r.profileDigest].every(d=>typeof d==='string'&&hex.test(d))||typeof r.processedAt!=='string'||!Number.isFinite(Date.parse(r.processedAt)))fail();
  const m=r.manifest,p=r.profile;
  if(!m||!m.context||m.format!=='inveos_raster_derivative_v1'||m.reviewState!=='unreviewed'||m.coordinates!=='top_left_pixels'||m.profileDigest!==r.profileDigest||JSON.stringify(m.limitations)!==JSON.stringify(['forms_omitted','annotations_omitted','greyscale','visual_fidelity_unapproved']))fail();
  for(const key of ['caseId','evidenceId','sourceDigest','authorityVersion'] as const)if(m.context[key]!==job[key])fail();
  if(m.context.jobId!==job.id||!p||p.format!=='inveos_raster_profile_v1'||p.scale!==1||p.rotation!==0||JSON.stringify(p.crop)!=='[0,0,0,0]'||p.grayscale!==true||p.forms!==false||p.annotations!==false)fail();
  if(!Array.isArray(m.pages)||m.pages.length<1||m.pages.length>2)fail();
  m.pages.forEach((page,i)=>{if(page.page!==i+1||![page.width,page.height,page.byteLength].every(Number.isInteger)||page.width<1||page.height<1||page.width>2048||page.height>2048||page.width*page.height>2000000||page.byteLength<57||page.byteLength>262144||!hex.test(page.digest))fail();});
  if(await jsonHash(m)!==r.derivativeDigest||await jsonHash(p)!==r.profileDigest)fail();
  return {job:{...job},processedAt:r.processedAt,derivativeDigest:r.derivativeDigest,profileDigest:r.profileDigest,pages:m.pages.map(p=>({...p}))};
}
export async function verifyRasterPage(response:Response,page:RasterPage):Promise<Blob>{
  if(!response.ok||response.headers.get('content-type')!=='image/png'||!response.body)fail();
  const reader=response.body!.getReader(),parts:Uint8Array[]=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>page.byteLength||total>262144)fail();parts.push(value);}}
  finally{await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  if(total!==page.byteLength||await hash(bytes)!==page.digest)fail();
  return new Blob([bytes],{type:'image/png'});
}
