import assert from 'node:assert/strict';
import {test} from 'node:test';
import {halfUp,lineAmounts,invoiceTotals,exactMinor} from '../src/agency-invoice-arithmetic.js';

test('invoice half-up arithmetic preserves minor-unit ties and the declared per-line tax sequence',()=>{
 assert.equal(halfUp(29n,60n),0n);assert.equal(halfUp(30n,60n),1n);assert.equal(halfUp(31n,60n),1n);
 assert.deepEqual(lineAmounts('time',1,30,5000),{netMinor:1,taxMinor:1,totalMinor:2});
 // Each source rounds independently, so two one-minute sources differ from one two-minute source.
 assert.deepEqual(invoiceTotals([lineAmounts('time',1,30,5000),lineAmounts('time',1,30,5000)]),{netMinor:2,taxMinor:2,totalMinor:4});
 assert.deepEqual(lineAmounts('time',2,30,5000),{netMinor:1,taxMinor:1,totalMinor:2});
 assert.deepEqual(lineAmounts('expense',1,1001,2000),{netMinor:1001,taxMinor:200,totalMinor:1201});
});
test('maximum bounded invoice quantities stay exact beyond safe floating multiplication',()=>{
 const line=lineAmounts('time',1440,1_000_000_000,10000);
 assert.deepEqual(line,{netMinor:24_000_000_000,taxMinor:24_000_000_000,totalMinor:48_000_000_000});
 assert.deepEqual(invoiceTotals(Array.from({length:100},()=>line)),{netMinor:2_400_000_000_000,taxMinor:2_400_000_000_000,totalMinor:4_800_000_000_000});
 assert.throws(()=>lineAmounts('time',1.5,1000,0),/integers/);
 assert.throws(()=>lineAmounts('time',1,Number.MAX_SAFE_INTEGER+1,0),/integers/);
 assert.throws(()=>exactMinor(5_000_000_000_001n),/limit/);
 assert.throws(()=>halfUp(-1n,60n),/nonnegative/);
});
