/** Actual isolated render-output acceptance; invoked separately by research CI. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {makeRasterDerivative,rasterProfileDigest} from '../src/raster-derivative.js';
import {sha256} from '../src/text-derivative.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('actual repeated isolated PNGs cross the bounded original-linked raster boundary',async t=>{
  const bytes=await readFile(new URL('../../../.research-cache/render-output.json',import.meta.url));assert.ok(bytes.length<=1048576);
  const receipt=JSON.parse(bytes.toString());assert.equal(receipt.status,'isolated_render_passed');assert.equal(receipt.runs.length,2);
  const digests:string[]=[];
  for(const run of receipt.runs){
    assert.equal(run.status,'synthetic_render_passed');const current:string[]=[];
    for(const [name,recipe] of Object.entries({digital:'digital_pdf()',mixed:"coverage_pdf(['text','raster'])",blank:"coverage_pdf(['blank','text'])",raster:"coverage_pdf(['raster'])"})){
      const generated=spawnSync('python3',['-c',`import sys;from tools.synthetic_pdf import digital_pdf,coverage_pdf;sys.stdout.buffer.write(${recipe})`],{cwd:root});
      assert.equal(generated.status,0);const original=generated.stdout;
      const context={tenantId:'fictional-tenant',caseId:'fictional-case',jobId:'fictional-render-'+name,evidenceId:'fictional-original-'+name,authorityVersion:1,sourceDigest:sha256(original)};
      const result={...run.cases[name],context,profileDigest:rasterProfileDigest};
      const checked=makeRasterDerivative(original,context,result);current.push(checked.digest);
      assert.equal(checked.manifest.reviewState,'unreviewed');
      assert.throws(()=>makeRasterDerivative(original,{...context,caseId:'foreign'},result));
      const bad=structuredClone(result);bad.pages[0].pngBase64=Buffer.from('not an image').toString('base64');
      assert.throws(()=>makeRasterDerivative(original,context,bad));
      assert.throws(()=>makeRasterDerivative(Buffer.concat([original,Buffer.from('changed')]),context,result));
      t.diagnostic(JSON.stringify({name,original:context.sourceDigest,manifest:checked.digest,pages:checked.manifest.pages}));
    }
    if(!digests.length)digests.push(...current);else assert.deepEqual(current,digests);
  }
});
