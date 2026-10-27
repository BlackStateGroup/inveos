import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { dispatchIntegrityJobs } from '../src/integrity-jobs.js';

test('dispatch validates explicit scope and bounds before acquiring any connection',async()=>{
  const pool={connect:()=>{throw new Error('Unexpected connection');}} as unknown as Pool;
  const scope={tenantId:randomUUID(),caseId:randomUUID()};
  for(const limit of [0,26,1.5,NaN,Infinity])await assert.rejects(dispatchIntegrityJobs(pool,'/unused',scope,limit),/Dispatch requires/);
  for(const s of [{...scope,tenantId:''},{...scope,caseId:'all'}])await assert.rejects(dispatchIntegrityJobs(pool,'/unused',s),/Dispatch requires/);
  const stopped=new AbortController();stopped.abort();
  assert.deepEqual(await dispatchIntegrityJobs(pool,'/unused',scope,25,stopped.signal),{selected:0,stopReason:'aborted',results:[]});
});
