/** First-party boundary for a research-only OCR result, never an OCR/PDF parser. */
import {parseDocumentRaw,type DocumentContext,type DocumentResult} from './document-derivative.js';
import {validateRasterPng} from './raster-derivative.js';
import {sha256} from './text-derivative.js';

export const ocrKind='tesseract_scan_lab_v1';
export const ocrProfile=JSON.stringify({format:'inveos_ocr_profile_v1',tool:'tesseract',version:'5.3.0-2',language:'eng',
  languagePackage:'1:4.1.0-2',artifactLock:'bfcdba20feb42105845bbce39b243925dd12133e9358630ab1384125c84e1172',
  wheelInventory:'2b796619e4ab39da1d75f6c99d77c5a15d4453fa89bf478764ab7a608e6c7116',
  pdfium:'5.14.0',pillow:'13.0.0',renderScale:2,colour:'RGB',forms:false,annotations:false,
  dpi:144,pageSegmentationMode:6,threads:1,maxPages:2,maxOriginalBytes:65536,maxWords:1000,
  maxRawBytes:1048576,timeoutSeconds:30,approval:'isolated_fictional_research_only'});
export const ocrProfileDigest=sha256(ocrProfile);
export const ocrExpandedKind='tesseract_scan_lab_v2';
export const ocrExpandedProfile=JSON.stringify({...JSON.parse(ocrProfile),format:'inveos_ocr_profile_v2',maxOriginalBytes:262144});
export const ocrExpandedProfileDigest=sha256(ocrExpandedProfile);
export function ocrConfiguration(kind:string){
  if(kind===ocrKind)return {kind,profile:ocrProfile,profileDigest:ocrProfileDigest,maxOriginalBytes:65536};
  if(kind===ocrExpandedKind)return {kind,profile:ocrExpandedProfile,profileDigest:ocrExpandedProfileDigest,maxOriginalBytes:262144};
  return undefined;
}
export const ocrArtifactLock=JSON.parse(ocrProfile).artifactLock as string;
function fail():never{throw new Error('Invalid OCR document result');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail();return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:string){if(Object.keys(value).sort().join(' ')!==keys.split(' ').sort().join(' '))fail();}
function integer(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value))fail();return value;}
function blob(value:unknown,max:number){if(typeof value!=='string'||!value.length||value.length>4*Math.ceil(max/3))fail();const b=Buffer.from(value,'base64');if(!b.length||b.length>max||b.toString('base64')!==value)fail();return b;}
const header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
/** Words keep their exact TSV row and confidence; normalised offsets are never original PDF offsets. */
export function ocrWords(raw:Buffer,width:number,height:number){
  if(!raw.length||raw.length>131072)fail();const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  if(text.includes('\r')||!text.endsWith('\n'))fail();const lines=text.slice(0,-1).split('\n');if(lines.shift()!==header||lines.length>5000)fail();
  const words:{text:string;confidence:number;row:number;x:number;y:number;w:number;h:number}[]=[];
  for(const [index,line] of lines.entries()){
    const columns=line.split('\t');if(columns.length!==12)fail();
    const values=columns.slice(0,10).map(v=>{if(!/^(0|[1-9][0-9]*)$/.test(v))fail();return Number(v);});
    if(values.some(v=>!Number.isSafeInteger(v))||values[0]!<1||values[0]!>5||values[1]!==1)fail();
    const [,,,,,,x,y,w,h]=values as [number,number,number,number,number,number,number,number,number,number];
    if(x<0||y<0||w<0||h<0||x+w>width||y+h>height)fail();
    if(values[0]!==5){if(columns[10]!=='-1'||columns[11]!=='')fail();continue;}
    const confidence=Number(columns[10]),word=columns[11]!;
    if(!/^(?:[0-9]+)(?:\.[0-9]+)?$/.test(columns[10]!)||!Number.isFinite(confidence)||confidence<0||confidence>100||!word||Buffer.byteLength(word)>500||/[\s\u0000-\u001f\u007f]/u.test(word)||w<=0||h<=0||words.length>=1000)fail();
    words.push({text:word,confidence,row:index+2,x,y,w,h});
  }
  return words;
}
export function makeOcrDerivative(original:Buffer,context:DocumentContext,result:DocumentResult,kind=ocrKind){
  const config=ocrConfiguration(kind);if(!config)fail();
  if(!original.length||original.length>config.maxOriginalBytes||original.subarray(0,5).toString()!=='%PDF-'||sha256(original)!==context.sourceDigest||result.successful!==true||result.profileDigest!==config.profileDigest)fail();
  for(const key of ['tenantId','caseId','jobId','evidenceId','sourceDigest','authorityVersion'] as const)if(result.context[key]!==context[key])fail();
  const raw=object(parseDocumentRaw(result.raw));exact(raw,'format originalSha256 runtimeImageId artifactLock pages');
  if(raw.format!=='inveos_tesseract_pages_v1'||raw.originalSha256!==context.sourceDigest||raw.artifactLock!==ocrArtifactLock||typeof raw.runtimeImageId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(raw.runtimeImageId)||!Array.isArray(raw.pages)||raw.pages.length<1||raw.pages.length>2)fail();
  let text='',offset=0;const counts:number[]=[],references:{itemRef:string;page:number;bbox:{l:number;r:number;b:number;t:number;origin:string};startByte:number;endByte:number;ocr:{tsvRow:number;confidence:number;pixelBox:number[];inputPngDigest:string;rawTsvDigest:string}}[]=[];
  const artifacts:{page:number;inputPngDigest:string;rawTsvDigest:string;renderScale:number;pixelWidth:number;pixelHeight:number}[]=[];
  const pages=raw.pages.map((v,index)=>{
    const p=object(v);exact(p,'page width height pngBase64 tsvBase64');const width=integer(p.width),height=integer(p.height);
    if(p.page!==index+1||width%2||height%2)fail();const png=blob(p.pngBase64,262144),tsv=blob(p.tsvBase64,131072);validateRasterPng(png,width,height,2);
    const inputPngDigest=sha256(png),rawTsvDigest=sha256(tsv),words=ocrWords(tsv,width,height);counts.push(words.length);
    artifacts.push({page:index+1,inputPngDigest,rawTsvDigest,renderScale:2,pixelWidth:width,pixelHeight:height});
    for(const word of words){
      if(references.length>=1000)fail();if(references.length){text+='\n';offset++;}const startByte=offset;text+=word.text;offset+=Buffer.byteLength(word.text);
      references.push({itemRef:`#/texts/${references.length}`,page:index+1,bbox:{l:word.x/2,r:(word.x+word.w)/2,b:(word.y+word.h)/2,t:word.y/2,origin:'TOPLEFT'},startByte,endByte:offset,
        ocr:{tsvRow:word.row,confidence:word.confidence,pixelBox:[word.x,word.y,word.x+word.w,word.y+word.h],inputPngDigest,rawTsvDigest}});
    }
    return {page:index+1,width:width/2,height:height/2};
  });
  const missing=counts.flatMap((n,i)=>n?[]:[i+1]);
  const derivative={format:'inveos_ocr_document_v1',context,profileDigest:config.profileDigest,rawDigest:sha256(result.raw),reviewState:'unreviewed',offsetBasis:'ocr_utf8_not_original_pdf',pages,text,references,
    coverage:{pageTextCounts:counts,pagesWithoutText:missing,disposition:missing.length?'needs_page_review':'unreviewed_text',completeExtractionVerified:false},
    ocr:{runtimeImageId:raw.runtimeImageId,artifactLock:ocrArtifactLock,artifacts,limitations:['ocr_may_be_wrong','reading_order_unreviewed','forms_omitted','annotations_omitted','visual_fidelity_unapproved']}};
  const bytes=Buffer.from(JSON.stringify(derivative));if(bytes.length>1048576)fail();return {derivative,bytes,digest:sha256(bytes),rawDigest:sha256(result.raw)};
}
