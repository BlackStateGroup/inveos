import {inspectPcm,type SpeechDerivative} from '@inveos/contracts';
import {parseDocumentRaw,type DocumentContext,type DocumentResult} from './document-derivative.js';
import {sha256} from './text-derivative.js';

export const speechKind='whisper_pcm_lab_v1';
// Frozen candidate profile. This is unreviewed model output, never an assertion
// that reported words or offsets correspond accurately to the supplied speech.
export const speechProfile=JSON.stringify({
 tool:'whisper.cpp',revision:'231638a0717b7822784297e5980965ffcec05810',
 inputLock:'de2d4a6e22f19a1110e6f3a5e99df30e3748ef298b545cae17e2489eb17784c0',
 binarySha256:'e372f264c6fda90c64c88f858f023a31fd1bcc00af77b20ae1d4da94bbcb66fe',
 modelSha256:'921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
 runtimeLock:'57081e0f0976be1e82bfb8f32494b1c6d31d9bce560742798b012c47efb3325d',
 modelBytes:77704715,model:'ggml-tiny.en',language:'en',threads:1,greedy:true,temperature:0,
 sampleRate:16000,maxOriginalBytes:262144,maxRawBytes:131072,maxSegments:128,maxSegmentBytes:16384,
 containerSeconds:100,network:false,corrections:'separate_human_records',
});
export const speechProfileDigest=sha256(speechProfile);
function fail():never{throw new Error('Invalid speech derivative provenance or bounded output.');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail();return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:string){if(Object.keys(value).sort().join(' ')!==keys)fail();}

export function makeSpeechDerivative(original:Buffer,context:DocumentContext,result:DocumentResult){
 const pcm=inspectPcm(original);
 if(sha256(original)!==context.sourceDigest||result.successful!==true||result.profileDigest!==speechProfileDigest||result.raw.length<1||result.raw.length>131072)fail();
 for(const key of ['tenantId','caseId','jobId','evidenceId','sourceDigest','authorityVersion'] as const)if(result.context[key]!==context[key])fail();
 const raw=object(parseDocumentRaw(result.raw));exact(raw,'format sampleRate samples segments');
 if(raw.format!=='inveos.whisper_research.v1'||raw.sampleRate!==16000||raw.samples!==pcm.samples||!Array.isArray(raw.segments)||raw.segments.length>128)fail();
 let previous=0,offset=0,text='';
 const segments=raw.segments.map((value,index)=>{
  const s=object(value);exact(s,'endMs startMs text');
  if(typeof s.startMs!=='number'||typeof s.endMs!=='number'||!Number.isSafeInteger(s.startMs)||!Number.isSafeInteger(s.endMs)||typeof s.text!=='string'||Buffer.byteLength(s.text)>16384||Buffer.from(s.text).toString('utf8')!==s.text||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s.text))fail();
  const startMs=s.startMs as number,endMs=s.endMs as number,segmentText=s.text as string;
  const rangeWithinOriginal=0<=startMs&&startMs<endMs&&endMs<=pcm.durationMs,ordered=previous<=startMs;
  previous=endMs;if(index){text+='\n';offset++;}const startByte=offset;text+=segmentText;offset+=Buffer.byteLength(segmentText);if(offset>131072)fail();
  return {index,sourcePointer:'/segments/'+index,startMs,endMs,text:segmentText,startByte,endByte:offset,rangeWithinOriginal,ordered};
 });
 const derivative:SpeechDerivative={format:'inveos_speech_derivative_v1',context,profileDigest:speechProfileDigest,rawDigest:sha256(result.raw),reviewState:'unreviewed',offsetBasis:'recognised_utf8_not_original_audio',audio:pcm,text,segments,coverage:{reportedRangesValid:segments.every(s=>s.rangeWithinOriginal&&s.ordered),alignmentVerified:false,speechAccuracyVerified:false}};
 const bytes=Buffer.from(JSON.stringify(derivative));if(bytes.length>524288)fail();
 return {derivative,bytes,digest:sha256(bytes),rawDigest:sha256(result.raw)};
}
