import {tikaKind,tikaProfileDigest} from './tika-derivative.js';
import {inspectPcm,type ProcessingKind,type ProcessingProfile} from '@inveos/contracts';
import {documentKind,documentProfileDigest} from './document-derivative.js';
import {ocrKind,ocrExpandedKind,ocrConfiguration} from './ocr-derivative.js';
import {rasterKind,rasterExpandedKind,rasterConfiguration} from './raster-derivative.js';
import {speechKind,speechProfileDigest} from './speech-derivative.js';
import {sha256,textConfiguration,textProcessor} from './text-derivative.js';
import {ApiError} from './errors.js';
export function processingProfiles(options:{documentLab?:boolean;speechLab?:boolean}):ProcessingProfile[]{
 const original:ProcessingProfile={kind:'original_sha256_v1',label:'Verify original SHA-256',profileDigest:sha256('original_sha256_v1:sha256:262144'),enabled:true,originalKind:'any',maxOriginalBytes:262144,isolated:false,limits:'Up to256KiB. Verifies byte equality only; does not clear quarantine or establish authenticity.'};
 const text:ProcessingProfile={kind:'utf8_line_index_v1',label:'Unreviewed UTF-8 line index',profileDigest:sha256(textProcessor+'\n'+textConfiguration),enabled:true,originalKind:'original_utf8',maxOriginalBytes:262144,isolated:false,limits:'UTF-8 originals only, up to256KiB; at most4096 lines and1MiB derivative output. No PDF extraction or human review.'};
 const binary=(kind:ProcessingKind,label:string,digest:string,size:number,limits:string,enabled=!!options.documentLab):ProcessingProfile=>({kind,label,profileDigest:digest,enabled,originalKind:'opaque_binary',maxOriginalBytes:size,isolated:true,limits});
 return [original,text,binary(tikaKind,'Tika PDF page text',tikaProfileDigest,2097152,'PDF only, up to2MiB and16 pages. Page-text UTF-8 locations only; no geometry, OCR, Office support or completeness claim.'),binary(documentKind,'Native PDF extraction',documentProfileDigest,65536,'Up to64KiB, at most2 pages. Native text only; no OCR, tables, forms or completeness claim.'),...([rasterKind,rasterExpandedKind] as const).map(kind=>{const p=rasterConfiguration(kind)!;return binary(kind,'PDF page images · '+(p.maxOriginalBytes/1024)+'KiB',p.profileDigest,p.maxOriginalBytes,'At most2 pages; greyscale,2048px dimension,2000000 pixels/page. Forms and annotations omitted.');}),...([ocrKind,ocrExpandedKind] as const).map(kind=>{const p=ocrConfiguration(kind)!;return binary(kind,'English scan OCR · '+(p.maxOriginalBytes/1024)+'KiB',p.profileDigest,p.maxOriginalBytes,'At most2 pages,1000 words; English,144dpi,PSM6. Known recognition errors; original-page comparison required.');}),binary(speechKind,'English PCM speech recognition',speechProfileDigest,262144,'Canonical mono16-bit16kHz PCM WAV only,44-byte header,up to256KiB (about8.19seconds maximum). English tiny.en model; recognition/alignment unreviewed.',!!options.speechLab)];
}
export class ProcessingEligibilityError extends ApiError {constructor(readonly code:string,message:string){super(409,message);}}
export function basicProcessingEligibility(profile:ProcessingProfile,source:{original_kind:string;byte_length:number}){
 if(!profile.enabled)throw new ProcessingEligibilityError('profile_disabled','This isolated processing lab is disabled. No worker is started by this request.');
 if(source.byte_length<1||source.byte_length>profile.maxOriginalBytes)throw new ProcessingEligibilityError('size_limit','Original exceeds the selected existing profile size limit. Choose deliberately; no fallback or rewriting occurs.');
 if(profile.originalKind!=='any'&&source.original_kind!==profile.originalKind)throw new ProcessingEligibilityError('original_kind','Original storage kind is unsupported by this profile.');
}
export function processingInputSignature(profile:ProcessingProfile,bytes:Buffer){
 if(profile.kind===speechKind){try{inspectPcm(bytes);}catch{throw new ProcessingEligibilityError('unsupported_media','Original is not the canonical bounded PCM WAV supported by this speech profile.');}}
 else if(profile.isolated&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new ProcessingEligibilityError('unsupported_media','This document profile requires PDF original bytes; filename and content-type are insufficient.');
 // This checks the existing boundary, never parses PDFs or claims page/table/media support.
}
