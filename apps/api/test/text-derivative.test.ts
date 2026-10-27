import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexText, makeTextDerivative, sha256, verifyTextDerivative } from '../src/text-derivative.js';

test('text index preserves BOM, multilingual bytes, repeated lines and all newline forms', async () => {
  const bytes=Buffer.from('\uFEFFFictional á😀\r\nمورد\rRepeated\nRepeated\n');
  const original=Buffer.from(bytes);
  const value=indexText(bytes);
  assert.equal(value.text,bytes.toString('utf8'));
  assert.deepEqual(value.lines.map(l=>bytes.subarray(l.startByte,l.endByte).toString()),['\uFEFFFictional á😀','مورد','Repeated','Repeated']);
  assert.equal(value.lines[0]!.nextByte-value.lines[0]!.endByte,2);
  assert.equal(value.lines[2]!.nextByte-value.lines[2]!.endByte,1);
  assert.equal(value.lines.at(-1)!.nextByte,bytes.length);
  assert.deepEqual(value.lines.map(l=>l.line),[1,2,3,4]);
  assert.deepEqual(bytes,original);
  const a=await makeTextDerivative(bytes),b=await makeTextDerivative(bytes);
  assert.deepEqual(a,b);
  assert.match(a.processorDigest,/^[a-f0-9]{64}$/);
  assert.match(a.runtime,/^node:/);
  assert.deepEqual(verifyTextDerivative(bytes,a.bytes,a.digest),value);
});

test('text index handles blank and unterminated lines without inventing trailing lines', () => {
  assert.deepEqual(indexText(Buffer.from('\r\n\nX')).lines,[
    {line:1,startByte:0,endByte:0,nextByte:2},{line:2,startByte:2,endByte:2,nextByte:3},{line:3,startByte:3,endByte:4,nextByte:4},
  ]);
  assert.equal(indexText(Buffer.from('X\n')).lines.length,1);
  assert.equal(indexText(Buffer.from('\n')).lines.length,1);
});

test('text index enforces input, output, UTF-8 and line bounds', async () => {
  for (const bytes of [Buffer.alloc(0),Buffer.alloc(262145),Buffer.from([0xff]),Buffer.from([0xc0,0x80]),Buffer.from('\n'.repeat(4097))]) assert.throws(()=>indexText(bytes));
  assert.equal(indexText(Buffer.from('\n'.repeat(4096))).lines.length,4096);
  await assert.rejects(makeTextDerivative(Buffer.alloc(262144,1)),/Derivative size limit/);
});

test('verification rejects changed originals and internally hashed fabricated offsets', async () => {
  const bytes=Buffer.from('Fictional á\nFictional á');
  const output=await makeTextDerivative(bytes);
  assert.throws(()=>verifyTextDerivative(Buffer.from('Changed'),output.bytes,output.digest));
  assert.throws(()=>verifyTextDerivative(bytes,output.bytes,'0'.repeat(64)));
  const altered=JSON.parse(output.bytes.toString());altered.lines[0].startByte=1;
  const forged=Buffer.from(JSON.stringify(altered));
  assert.throws(()=>verifyTextDerivative(bytes,forged,sha256(forged)));
});
