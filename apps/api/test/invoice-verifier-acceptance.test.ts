import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {InvoiceRevision,InvoiceExport} from '@inveos/contracts';
import {workflowFixture} from './support/workflow-fixture.js';
const exec=promisify(execFile);
test('copied standalone invoice verifier accepts actual API arithmetic and rejects altered frozen money',{timeout:45000},async()=>{const f=await workflowFixture(),copy=await mkdtemp(join(tmpdir(),'inveos-invoice-verifier-'));try{
 const id=randomUUID(),reason='Fictional explicit arithmetic and retained-original review only.';await f.must(f.base+'/time-entries',{id,startedAt:'2026-10-20T15:30:00+01:00',minutes:1,description:'Fictional source-free case review time.',billable:true},f.investigator.headers);await f.must(f.base+'/agency/declarations',{id:randomUUID(),expectedVersion:0,currency:'GBP',recipientId:f.client.id,billTo:'Fictional Billing Company',billingBasis:'Fictional explicitly declared internal billing exercise.',hourlyRateMinor:30,expenseTreatment:'at_cost',taxTreatment:'exclusive_rate',taxBasisPoints:5000,taxLabel:'Fictional arithmetic only, not statutory tax advice',rounding:'per_line_half_up',fictional:true,reason});
 const draft=await f.must<InvoiceRevision>(f.base+'/agency/invoices',{id:randomUUID(),currency:'GBP',declarationVersion:1,reference:'FICTIONAL-COPIED-VERIFIER',reason,lines:[{kind:'time',id,version:1}],confirmInternalDraft:true}),path=f.base+'/agency/invoices/'+draft.snapshot.invoiceId;await f.must(path+'/review',{id:randomUUID(),expectedVersion:1,sha256:draft.sha256,accepted:true,reason,confirmSourceAndBudgetReview:true},f.reviewer.headers);const exported=await f.must<InvoiceExport>(path+'/revisions/1/export');assert.deepEqual(draft.snapshot.totals,{currency:'GBP',netMinor:1,taxMinor:1,totalMinor:2});await copyFile('tools/verify_internal_invoice.py',join(copy,'verify_internal_invoice.py'));await writeFile(join(copy,'invoice.json'),JSON.stringify(exported));await exec('python3',['verify_internal_invoice.py','invoice.json','--expected-sha256',draft.sha256],{cwd:copy,env:{...process.env,PYTHONPATH:''}});
 const tampered=JSON.parse(Buffer.from(exported.snapshotBase64,'base64').toString());tampered.totals.totalMinor=1;await writeFile(join(copy,'invoice.json'),JSON.stringify({...exported,snapshotBase64:Buffer.from(JSON.stringify(tampered)).toString('base64')}));await assert.rejects(exec('python3',['verify_internal_invoice.py','invoice.json','--expected-sha256',draft.sha256],{cwd:copy,env:{...process.env,PYTHONPATH:''}}));
 }finally{await f.close();await rm(copy,{recursive:true,force:true});}});
