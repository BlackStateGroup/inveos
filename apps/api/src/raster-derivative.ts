/** First-party validation of the narrow research PNG profile; never loads a PDF. */
import {inflateSync} from 'node:zlib';
import {sha256} from './text-derivative.js';
import {documentProfile,type DocumentContext} from './document-derivative.js';

const native=JSON.parse(documentProfile);
export const rasterProfile=JSON.stringify({format:'inveos_raster_profile_v1',image:native.image,imageId:native.imageId,
  wheelInventory:native.wheelInventory,pdfium:'5.14.0',pillow:'13.0.0',scale:1,rotation:0,crop:[0,0,0,0],
  grayscale:true,forms:false,annotations:false,maxPages:2,maxOriginalBytes:65536,maxDimension:2048,maxPixels:2000000,maxPngBytes:262144});
export const rasterProfileDigest=sha256(rasterProfile);
export const rasterKind='pdf_raster_lab_v1',rasterExpandedKind='pdf_raster_lab_v2';
export const rasterExpandedProfile=JSON.stringify({...JSON.parse(rasterProfile),format:'inveos_raster_profile_v2',maxOriginalBytes:262144});
export const rasterExpandedProfileDigest=sha256(rasterExpandedProfile);
export function rasterConfiguration(kind:string){
  if(kind===rasterKind)return {kind,profile:rasterProfile,profileDigest:rasterProfileDigest,maxOriginalBytes:65536};
  if(kind===rasterExpandedKind)return {kind,profile:rasterExpandedProfile,profileDigest:rasterExpandedProfileDigest,maxOriginalBytes:262144};
  return undefined;
}
function fail():never{throw new Error('Invalid raster derivative');}
export function pngCrc(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
/** Accept only non-interlaced 8-bit greyscale, with no metadata/animation/extra streams. */
export function validateRasterPng(png:Buffer,width:number,height:number,colourType:0|2=0){
  if(colourType!==0&&colourType!==2)fail();
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>2048||height>2048||width*height>2000000||
    png.length<57||png.length>262144||!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))fail();
  let offset=8,header=false,ended=false;const parts:Buffer[]=[];
  while(offset<png.length){
    if(offset+12>png.length||ended)fail();
    const size=png.readUInt32BE(offset),end=offset+12+size;if(end>png.length)fail();
    const type=png.toString('latin1',offset+4,offset+8),data=png.subarray(offset+8,offset+8+size);
    if(pngCrc(png.subarray(offset+4,end-4))!==png.readUInt32BE(end-4))fail();
    if(type==='IHDR'){
      if(header||offset!==8||size!==13||data.readUInt32BE(0)!==width||data.readUInt32BE(4)!==height||
        !data.subarray(8).equals(Buffer.from([8,colourType,0,0,0])))fail();header=true;
    }else if(type==='IDAT'){if(!header||size===0)fail();parts.push(data);}
    else if(type==='IEND'){if(!header||!parts.length||size!==0||end!==png.length)fail();ended=true;}
    else fail();
    offset=end;
  }
  if(!ended)fail();
  const stride=width*(colourType===2?3:1)+1;
  const compressed=Buffer.concat(parts),expected=stride*height;
  const result=inflateSync(compressed,{maxOutputLength:expected,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
  if(result.buffer.length!==expected||result.engine.bytesWritten!==compressed.length)fail();
  for(let y=0;y<height;y++)if(result.buffer[y*stride]!>4)fail();
  return {width,height,byteLength:png.length,digest:sha256(png)};
}
type Page={page:number;width:number;height:number;pngSha256:string;pngBytes:number;pngBase64:string};
export type RasterResult={context:DocumentContext;profileDigest:string;originalSha256:string;pages:Page[]};
export function makeRasterDerivative(original:Buffer,context:DocumentContext,result:RasterResult,kind=rasterKind){
  const config=rasterConfiguration(kind);if(!config)fail();
  if(original.length<1||original.length>config.maxOriginalBytes||original.subarray(0,5).toString()!=='%PDF-'||sha256(original)!==context.sourceDigest||
    result.originalSha256!==context.sourceDigest||result.profileDigest!==config.profileDigest)fail();
  for(const key of ['tenantId','caseId','jobId','evidenceId','sourceDigest','authorityVersion'] as const)if(result.context[key]!==context[key])fail();
  if(!Array.isArray(result.pages)||result.pages.length<1||result.pages.length>2)fail();
  const pages=result.pages.map((p,i)=>{
    if(p.page!==i+1||typeof p.pngBase64!=='string'||p.pngBase64.length>349528)fail();
    const bytes=Buffer.from(p.pngBase64,'base64');if(bytes.toString('base64')!==p.pngBase64)fail();
    const checked=validateRasterPng(bytes,p.width,p.height);
    if(checked.digest!==p.pngSha256||checked.byteLength!==p.pngBytes)fail();
    return {page:p.page,...checked,bytes};
  });
  const manifest={format:'inveos_raster_derivative_v1',context:{tenantId:context.tenantId,caseId:context.caseId,jobId:context.jobId,evidenceId:context.evidenceId,sourceDigest:context.sourceDigest,authorityVersion:context.authorityVersion},profileDigest:config.profileDigest,reviewState:'unreviewed',
    coordinates:'top_left_pixels',limitations:['forms_omitted','annotations_omitted','greyscale','visual_fidelity_unapproved'],
    pages:pages.map(p=>({page:p.page,width:p.width,height:p.height,byteLength:p.byteLength,digest:p.digest}))};
  const bytes=Buffer.from(JSON.stringify(manifest));
  return {manifest,bytes,digest:sha256(bytes),pages};
}
