import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deflateSync} from 'node:zlib';
import {makeRasterDerivative,pngCrc,validateRasterPng,rasterProfileDigest} from '../src/raster-derivative.js';
import {sha256} from '../src/text-derivative.js';
function chunk(type:string,data=Buffer.alloc(0)){const body=Buffer.concat([Buffer.from(type),data]),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);body.copy(b,4);b.writeUInt32BE(pngCrc(body),b.length-4);return b;}
function png(raw=Buffer.from([0,255]),extra:Buffer[]=[],headerChange?:(h:Buffer)=>void,compressed=deflateSync(raw)){
  const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;headerChange?.(h);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',compressed),...extra,chunk('IEND')]);
}
const original=Buffer.from('%PDF-FICTIONAL boundary test, not a parsed PDF');
const context={tenantId:'fictional-tenant',caseId:'fictional-case',jobId:'fictional-job',evidenceId:'fictional-source',authorityVersion:1,sourceDigest:sha256(original)};
function result(bytes=png()){return {context:{...context},profileDigest:rasterProfileDigest,originalSha256:sha256(original),
  pages:[{page:1,width:1,height:1,pngSha256:sha256(bytes),pngBytes:bytes.length,pngBase64:bytes.toString('base64')}]};}
test('bounded greyscale PNG retains original identity, page digest and unreviewed limitations',()=>{
  const r=makeRasterDerivative(original,context,result());assert.equal(r.pages[0]!.digest,sha256(png()));
  assert.equal(r.manifest.reviewState,'unreviewed');assert.equal(r.manifest.context.evidenceId,context.evidenceId);
  assert.deepEqual(r.manifest.limitations,['forms_omitted','annotations_omitted','greyscale','visual_fidelity_unapproved']);
  assert.equal(r.digest,makeRasterDerivative(original,context,result()).digest);
});
test('PNG rejects corruption, trailing bytes, metadata, animation and incompatible headers',()=>{
  const corrupted=png();corrupted[corrupted.length-1]=corrupted[corrupted.length-1]!^1;
  for(const b of [corrupted,Buffer.concat([png(),Buffer.from('hidden')]),png().subarray(0,-12),
    png(undefined,[chunk('tEXt',Buffer.from('hidden'))]),png(undefined,[chunk('acTL',Buffer.alloc(8))]),
    png(undefined,[],h=>{h[12]=1;}),png(undefined,[],h=>{h[9]=2;})])assert.throws(()=>validateRasterPng(b,1,1));
});
test('PNG rejects expansion bombs, short scanlines, invalid filters and concatenated zlib streams',()=>{
  for(const b of [png(Buffer.alloc(100000)),png(Buffer.alloc(1)),png(Buffer.from([5,0])),
    png(undefined,[],undefined,Buffer.concat([deflateSync(Buffer.from([0,255])),deflateSync(Buffer.from([0,0]))]))])assert.throws(()=>validateRasterPng(b,1,1));
});
test('PNG requires matching bounded dimensions and canonical base64',()=>{
  for(const pair of [[0,1],[1,0],[2049,1],[2000,2000],[1.5,1],[NaN,1],[2,1]])assert.throws(()=>validateRasterPng(png(),pair[0]!,pair[1]!));
  const r=result();r.pages[0]!.pngBase64+='\n';assert.throws(()=>makeRasterDerivative(original,context,r));
});
test('raster boundary denies changed context, source, profile, hashes and page ordering',()=>{
  for(const key of ['tenantId','caseId','jobId','evidenceId','sourceDigest'] as const){const r=result();r.context[key]='wrong';assert.throws(()=>makeRasterDerivative(original,context,r));}
  for(const mutate of [(r:ReturnType<typeof result>)=>{r.context.authorityVersion=2;},(r:ReturnType<typeof result>)=>{r.profileDigest='wrong';},
    (r:ReturnType<typeof result>)=>{r.originalSha256='wrong';},(r:ReturnType<typeof result>)=>{r.pages[0]!.page=2;},
    (r:ReturnType<typeof result>)=>{r.pages[0]!.pngSha256='wrong';},(r:ReturnType<typeof result>)=>{r.pages[0]!.pngBytes++;},
    (r:ReturnType<typeof result>)=>{r.pages=[];}]){const r=result();mutate(r);assert.throws(()=>makeRasterDerivative(original,context,r));}
  assert.throws(()=>makeRasterDerivative(Buffer.from('%PDF-substituted'),context,result()));
});

test('manifest context ordering is fixed and unrelated caller metadata is excluded',()=>{
  const reordered={authorityVersion:1,sourceDigest:context.sourceDigest,evidenceId:context.evidenceId,jobId:context.jobId,caseId:context.caseId,tenantId:context.tenantId,internalNote:'must not enter manifest'};
  const a=makeRasterDerivative(original,context,result()),b=makeRasterDerivative(original,reordered,result());
  assert.equal(a.digest,b.digest);assert.ok(!b.bytes.toString().includes('internalNote'));
});

test('expanded raster keeps the v1 profile immutable and rejects cross-profile or excessive originals',async()=>{
 const {rasterExpandedKind,rasterExpandedProfileDigest,rasterExpandedProfile,rasterProfile}=await import('../src/raster-derivative.js');assert.equal(rasterProfileDigest,'80bf6d3f398ca89c0c192371fbed4af8899eefb4bdda8e764dc89ecebed5d569');assert.equal(JSON.parse(rasterProfile).maxOriginalBytes,65536);assert.equal(JSON.parse(rasterExpandedProfile).maxOriginalBytes,262144);
 const larger=Buffer.concat([original,Buffer.alloc(262144-original.length,32)]),scope={...context,sourceDigest:sha256(larger)},output={...result(),context:scope,originalSha256:scope.sourceDigest,profileDigest:rasterExpandedProfileDigest};assert.throws(()=>makeRasterDerivative(larger,scope,output));assert.throws(()=>makeRasterDerivative(original,context,result(),rasterExpandedKind));assert.throws(()=>makeRasterDerivative(larger,scope,{...output,profileDigest:rasterProfileDigest},rasterExpandedKind));assert.throws(()=>makeRasterDerivative(Buffer.concat([larger,Buffer.from('x')]),scope,output,rasterExpandedKind));const accepted=makeRasterDerivative(larger,scope,output,rasterExpandedKind);assert.equal(accepted.manifest.profileDigest,rasterExpandedProfileDigest);assert.equal(accepted.pages[0]!.digest,sha256(png()));
});
