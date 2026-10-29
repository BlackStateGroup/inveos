import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeRasterDerivative,rasterProfile,rasterProfileDigest} from '../src/raster-derivative.js';
import {sha256} from '../src/text-derivative.js';
import {inspectRaster,verifyRasterPage} from '../../web/src/rasterInspection.js';
async function fixture(){
  const original=Buffer.from('%PDF-1.4 FICTIONAL inspection fixture');
  const png=JSON.parse(await readFile(new URL('../../../research/runtime_artifacts/render-page-fixture.json',import.meta.url),'utf8'));
  const bytes=Buffer.from(png.pngBase64,'base64'),job={id:'job-fiction',caseId:'case-fiction',evidenceId:'evidence-fiction',sourceDigest:sha256(original),authorityVersion:1,kind:'pdf_raster_lab_v1',status:'succeeded'};
  const context={tenantId:'tenant-fiction',caseId:job.caseId,jobId:job.id,evidenceId:job.evidenceId,sourceDigest:job.sourceDigest,authorityVersion:1};
  const output=makeRasterDerivative(original,context,{context,profileDigest:rasterProfileDigest,originalSha256:job.sourceDigest,pages:[1,2].map(page=>({page,width:612,height:792,pngSha256:png.sha256,pngBytes:bytes.length,pngBase64:png.pngBase64}))});
  return {bytes,job,response:{...job,jobId:job.id,status:'unreviewed_derivative',processedAt:'2026-10-29T00:00:00Z',profile:JSON.parse(rasterProfile),profileDigest:rasterProfileDigest,derivativeDigest:output.digest,manifest:output.manifest}};
}
test('raster inspection binds manifest to selected job and verifies exact PNG bytes',async()=>{const f=await fixture();const r=await inspectRaster(f.response,f.job);assert.equal(r.pages[1]!.page,2);const blob=await verifyRasterPage(new Response(f.bytes,{headers:{'content-type':'image/png'}}),r.pages[1]!);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),f.bytes);});
test('raster inspection rejects substituted identity, profile, page geometry and manifest',async()=>{const f=await fixture();for(const mutate of [(r:typeof f.response)=>{r.caseId='foreign';},(r:typeof f.response)=>{r.manifest.context.jobId='foreign';},(r:typeof f.response)=>{r.profile.scale=2;},(r:typeof f.response)=>{r.manifest.pages[0]!.width=0;},(r:typeof f.response)=>{r.manifest.pages[0]!.digest='a'.repeat(64);},(r:typeof f.response)=>{r.manifest.reviewState='approved';}]){const value=structuredClone(f.response);mutate(value);await assert.rejects(inspectRaster(value,f.job));}});
test('raster byte verification rejects errors, MIME changes, truncated, changed and excess output',async()=>{const f=await fixture(),p=(await inspectRaster(f.response,f.job)).pages[0]!;for(const response of [new Response(f.bytes,{status:403,headers:{'content-type':'image/png'}}),new Response(f.bytes),new Response(f.bytes.subarray(1),{headers:{'content-type':'image/png'}}),new Response(Buffer.alloc(f.bytes.length),{headers:{'content-type':'image/png'}}),new Response(Buffer.concat([f.bytes,Buffer.from('x')]),{headers:{'content-type':'image/png'}})])await assert.rejects(verifyRasterPage(response,p));});
