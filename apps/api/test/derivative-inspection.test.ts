import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {indexText,makeTextDerivative,sha256,textConfiguration,textProcessor} from '../src/text-derivative.js';
import {inspectTextDerivative,type InspectionJob} from '../../web/src/derivativeInspection.js';
async function fixture(text='\uFEFFFictional á😀\r\nمورد\rRepeated\nRepeated\n<script>fictional()</script>'){
  const bytes=Buffer.from(text),out=await makeTextDerivative(bytes);
  const job:InspectionJob={id:randomUUID(),caseId:randomUUID(),evidenceId:randomUUID(),sourceDigest:sha256(bytes),authorityVersion:1,kind:'utf8_line_index_v1',status:'succeeded'};
  const response={jobId:job.id,caseId:job.caseId,evidenceId:job.evidenceId,sourceDigest:job.sourceDigest,authorityVersion:1,status:'unreviewed_derivative',
    processor:textProcessor,processorDigest:out.processorDigest,runtime:out.runtime,processedAt:'2026-10-27T18:00:00Z',derivativeDigest:out.digest,
    configuration:JSON.parse(textConfiguration),configurationDigest:sha256(textConfiguration),derivative:JSON.parse(out.bytes.toString())};
  return {job,response};
}
test('client inspection verifies real processor bytes, BOM, Unicode, repeated lines and markup preserved as text',async()=>{
  const {job,response}=await fixture();const view=await inspectTextDerivative(response,job);
  assert.deepEqual(view.lines.map(l=>l.text),['\uFEFFFictional á😀','مورد','Repeated','Repeated','<script>fictional()</script>']);
  const bytes=Buffer.from(response.derivative.text);
  for(const line of view.lines)assert.equal(bytes.subarray(line.startByte,line.endByte).toString(),line.text);
  assert.equal(view.derivativeDigest,response.derivativeDigest);
  const blank=await fixture('\n\r\n');assert.deepEqual((await inspectTextDerivative(blank.response,blank.job)).lines.map(l=>l.text),['','']);
});
test('client inspection rejects cross-job lineage, wrong states and replaced hashes/configuration',async()=>{
  const {job,response}=await fixture();
  for(const change of [{jobId:randomUUID()},{caseId:randomUUID()},{evidenceId:randomUUID()},{authorityVersion:2},{status:'accepted'},
    {sourceDigest:'a'.repeat(64)},{derivativeDigest:'b'.repeat(64)},{configurationDigest:'c'.repeat(64)},{configuration:{}},{processor:'unknown'}])
    await assert.rejects(inspectTextDerivative({...response,...change},job),/could not be verified/);
  for(const change of [{status:'running'},{kind:'original_sha256_v1'}])await assert.rejects(inspectTextDerivative(response,{...job,...change}));
});
test('client inspection rejects self-consistently hashed invented ranges, changed text and unsupported output',async()=>{
  const {job,response}=await fixture();
  const forged=structuredClone(response);forged.derivative.lines[0].endByte=1;forged.derivativeDigest=sha256(JSON.stringify(forged.derivative));
  await assert.rejects(inspectTextDerivative(forged,job));
  const replaced=structuredClone(response);replaced.derivative=indexText(Buffer.from('Fictional replacement'));replaced.derivativeDigest=sha256(JSON.stringify(replaced.derivative));
  await assert.rejects(inspectTextDerivative(replaced,job));
  for(const derivative of [null,{format:'inveos_text_lines_v1',text:'x'.repeat(262145),lines:[]},{...response.derivative,text:'\ud800'}, {...response.derivative,extra:'unsupported'}])
    await assert.rejects(inspectTextDerivative({...response,derivative},job));
});
