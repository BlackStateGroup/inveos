/** Synthetic contract validation only: no parser or host probe is executed. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeTikaDerivative,tikaCitation,tikaPages} from '../src/tika-derivative.js';
import {syntheticTikaContract} from './support/tika-contract.js';
import {hash} from './support/source-family.js';
const original=Buffer.from('%PDF-1.4\nFICTIONAL SYNTHETIC CONTRACT ONLY'),context={tenantId:randomUUID(),caseId:randomUUID(),jobId:randomUUID(),evidenceId:randomUUID(),sourceDigest:hash(original),authorityVersion:1};
test('Tika contract rejects mismatched context, profile, original, raw, runtime and malformed/external XHTML',()=>{
 const valid=syntheticTikaContract(original,context);assert.equal(makeTikaDerivative(original,context,valid).derivative.pages.length,2);
 for(const invalid of [{...valid,context:{...context,caseId:randomUUID()}},{...valid,profileDigest:'0'.repeat(64)},{...valid,raw:Buffer.from('{}')},{...valid,runtime:{...valid.runtime,preparation:{}}}])assert.throws(()=>makeTikaDerivative(original,context,invalid));assert.throws(()=>makeTikaDerivative(Buffer.from('Office unsupported'),context,valid));
 for(const raw of ['{"format":1,"format":2}','['.repeat(150)+'0'+']'.repeat(150)])assert.throws(()=>makeTikaDerivative(original,context,{...valid,raw:Buffer.from(raw)}));
 for(const xml of ['<!DOCTYPE html SYSTEM "https://never-fetch.example.test"><html/>','<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="page">&external;</div></body></html>','<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="page" xmlns="http://foreign.example.test">Bad</div></body></html>'])assert.throws(()=>tikaPages(Buffer.from(xml),1));
});
test('page-text UTF-8 offsets distinguish repeated occurrences/pages, reject split code points and expose empty pages',()=>{
 const contract=syntheticTikaContract(original,context),raw=JSON.parse(contract.raw.toString()),xhtml=Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="page">café café</div><div class="page"><p> </p></div></body></html>');raw.xhtmlBase64=xhtml.toString('base64');raw.xhtmlSha256=hash(xhtml);contract.raw=Buffer.from(JSON.stringify(raw));const output=makeTikaDerivative(original,context,contract);assert.deepEqual(output.derivative.coverage.pagesWithoutText,[2]);const selection={derivativeDigest:output.digest,page:1,startByte:6,endByte:11,quote:'café'};assert.equal(tikaCitation(output,selection).location.startByte,6);assert.throws(()=>tikaCitation(output,{...selection,startByte:4,endByte:5,quote:'é'}));assert.throws(()=>tikaCitation(output,{...selection,page:2}));assert.throws(()=>tikaCitation(output,{...selection,derivativeDigest:'0'.repeat(64)}));assert.equal('bbox' in tikaCitation(output,selection).location,false);
});
