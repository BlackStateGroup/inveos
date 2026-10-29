import {parseDocumentRaw} from './document-derivative.js';
import {ApiError} from './errors.js';
export type SuppliedSegment={id:string;startMs:number;endMs:number;speakerLabel:string;speakerUncertain:boolean;text:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const transcriptFormat='inveos.supplied_transcript.v1';
export const transcriptText=(value:unknown,max:number):value is string=>typeof value==='string'&&Buffer.from(value,'utf8').toString('utf8')===value&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export function suppliedSegments(value:unknown):SuppliedSegment[]{
 if(!Array.isArray(value)||value.length<1||value.length>100)throw new ApiError(422,'Supply between one and 100 transcript segments.');
 const ids=new Set<string>();return value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join(',')!=='endMs,id,speakerLabel,speakerUncertain,startMs,text')throw new ApiError(422,'The supplied transcript segment format is invalid.');
  const {id,startMs,endMs,speakerLabel,speakerUncertain,text}=item;
  if(typeof id!=='string'||!uuid.test(id)||ids.has(id)||!Number.isInteger(startMs)||!Number.isInteger(endMs)||startMs<0||endMs<=startMs||endMs>86400000||!transcriptText(speakerLabel,120)||typeof speakerUncertain!=='boolean'||!transcriptText(text,10000))throw new ApiError(422,'Supply distinct segment identities, bounded text and valid declared time ranges.');
  ids.add(id);return {id,startMs,endMs,speakerLabel,speakerUncertain,text};
 });
}
export function parseSuppliedTranscript(bytes:Buffer):SuppliedSegment[]{
 let value;try{value=parseDocumentRaw(bytes);}catch{throw new ApiError(422,'Original must contain a supplied transcript JSON record.');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='format,segments'||!('format' in value)||value.format!==transcriptFormat||!('segments' in value))throw new ApiError(422,'Original must use the supplied transcript format.');
 return suppliedSegments(value.segments);
}
