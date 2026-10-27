import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyRevisionDownload} from '../../web/src/reportDownload.js';

test('download guard verifies exact bytes and fails on changed data, missing headers or replaced receipts',async()=>{
  const bytes=new TextEncoder().encode('{"fictional":"á😀","status":"draft_not_released"}\n');
  const expected=createHash('sha256').update(bytes).digest('hex');
  await verifyRevisionDownload(bytes.buffer,expected,expected);
  const changed=bytes.slice();changed[1]=33;
  await assert.rejects(verifyRevisionDownload(changed.buffer,expected,expected),/fingerprint/);
  await assert.rejects(verifyRevisionDownload(bytes.buffer,expected,null),/fingerprint/);
  await assert.rejects(verifyRevisionDownload(bytes.buffer,expected,'0'.repeat(64)),/fingerprint/);
  await assert.rejects(verifyRevisionDownload(bytes.buffer,'0'.repeat(64),'0'.repeat(64)),/fingerprint/);
  await assert.rejects(verifyRevisionDownload(bytes.buffer,'invalid','invalid'),/fingerprint/);
});
