/** Fabricated boundary bytes, not a parser execution or an accuracy fixture. */
import {deflateSync} from 'node:zlib';
import {pngCrc} from '../../src/raster-derivative.js';
import {ocrArtifactLock,ocrProfileDigest,makeOcrDerivative} from '../../src/ocr-derivative.js';
import {sha256} from '../../src/text-derivative.js';
export function ocrFixture(){
 const chunk=(kind:string,data:Buffer)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(kind,4);data.copy(b,8);b.writeUInt32BE(pngCrc(b.subarray(4,-4)),b.length-4);return b;};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(64);ihdr.writeUInt32BE(64,4);ihdr[8]=8;ihdr[9]=2;
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc(64*(64*3+1)))),chunk('IEND',Buffer.alloc(0))]);
 const header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';
 const tsv=Buffer.from(header+'1\t1\t0\t0\t0\t0\t0\t0\t64\t64\t-1\t\n5\t1\t1\t1\t1\t1\t10\t12\t20\t10\t96.75\tATLAS\n5\t1\t1\t1\t1\t2\t32\t12\t10\t10\t89.5\t60\n');
 const original=Buffer.from('%PDF-1.4\nFICTIONAL boundary-only bytes, not a valid PDF\n');
 const context={tenantId:'00000000-0000-4000-8000-000000000001',caseId:'00000000-0000-4000-8000-000000000002',jobId:'00000000-0000-4000-8000-000000000003',evidenceId:'00000000-0000-4000-8000-000000000004',sourceDigest:sha256(original),authorityVersion:1};
 const envelope={format:'inveos_tesseract_pages_v1',originalSha256:context.sourceDigest,runtimeImageId:'sha256:'+'a'.repeat(64),artifactLock:ocrArtifactLock,pages:[{page:1,width:64,height:64,pngBase64:png.toString('base64'),tsvBase64:tsv.toString('base64')}]};
 const result={context,profileDigest:ocrProfileDigest,successful:true,raw:Buffer.from(JSON.stringify(envelope))};
 return {original,context,envelope,result,png,tsv,output:makeOcrDerivative(original,context,result)};
}
