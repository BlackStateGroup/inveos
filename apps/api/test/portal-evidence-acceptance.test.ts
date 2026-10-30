import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {InternalEvidenceRequest,PortalEvidenceRequest,PortalUpload,ManualSourceRecord,ManualSourceEntry} from '@inveos/contracts';
import {workflowFixture,tenant,sha} from './support/workflow-fixture.js';

const reason='Fictional acceptance correction with explicit retained history.';
test('portal intake preserves exact bytes/declarations, retries, concurrent completion and private DTOs',{timeout:60000},async()=>{
 const f=await workflowFixture();try{const q=await f.request(),r=await f.reserve(q,Buffer.alloc(32769,65));const list=await f.must<{items:PortalEvidenceRequest[]}>('/api/portal/evidence-requests',undefined,f.client.headers);assert.equal(list.items.length,1);
 const encoded=JSON.stringify(list);for(const forbidden of [f.caseId,f.investigator.id,f.reviewer.id,'INTERNAL SECRET','authorityVersion','evidenceId','caseId','object_path'])assert.ok(!encoded.includes(forbidden),forbidden);
 assert.equal((await f.call(q.external+'/uploads',{...r.input,byteLength:262145},f.client.headers)).statusCode,422);
 assert.equal((await f.call(q.external+'/uploads',{...r.input,method:'A changed fictional declaration'},f.client.headers)).statusCode,409);
 assert.equal((await f.call(q.external+'/uploads/'+r.u.id+'/chunk',{ordinal:0,contentBase64:Buffer.from('short').toString('base64')},f.client.headers)).statusCode,422);
 assert.equal((await f.call(q.external+'/uploads/'+r.u.id+'/complete',{},f.client.headers)).statusCode,409);
 await f.chunks(q,r);const completed=await Promise.all([1,2].map(()=>f.call(q.external+'/uploads/'+r.u.id+'/complete',{},f.client.headers)));completed.forEach(x=>assert.equal(x.statusCode,200,x.body));const u=completed[0]!.json<PortalUpload>();assert.deepEqual(completed[1]!.json(),u);assert.equal(u.receipt!.sha256,sha(r.bytes));assert.equal(u.receipt!.declaration.sourceTime,r.input.sourceTime);assert.notEqual(u.receipt!.receivedAt,r.input.sourceTime);
 assert.deepEqual(await f.must(q.external+'/uploads/by-key/'+r.input.idempotencyKey,undefined,f.client.headers),u);assert.equal((await f.must<PortalUpload>(q.external+'/uploads',r.input,f.client.headers)).receipt!.id,u.receipt!.id);
 const internal=await f.must<InternalEvidenceRequest>(f.base+'/evidence-requests/'+q.g.id),receipt=internal.receipts[0]!;assert.equal(internal.receipts.length,1);const original=await f.call(f.base+'/evidence/'+receipt.evidenceId+'/original');assert.deepEqual(original.rawPayload,r.bytes);assert.equal(original.headers['x-inveos-original-state'],'Quarantined');assert.equal((await f.call(f.base+'/evidence/'+receipt.evidenceId+'/original',undefined,f.client.headers)).statusCode,403);
 for(const forbidden of [receipt.evidenceId,f.caseId,f.investigator.id,f.reviewer.id,'sourceReference'])assert.ok(!JSON.stringify(u).includes(forbidden),forbidden);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,1);assert.equal((await f.pool.query('SELECT count(*)::int n FROM upload_chunks WHERE case_id=$1',[f.caseId])).rows[0].n,0);
 await assert.rejects(f.pool.query("UPDATE portal_evidence_receipts SET byte_length=1 WHERE case_id=$1",[f.caseId]),/permission denied|immutable|append/i);
 const object=(await f.admin.query('SELECT object_path FROM evidence WHERE id=$1',[receipt.evidenceId])).rows[0].object_path,filename=join(f.root,object),bytes=await readFile(filename);await writeFile(filename,'Fictional deliberate corruption');assert.equal((await f.call(q.external+'/uploads/'+u.id,undefined,f.client.headers)).statusCode,409);await writeFile(filename,bytes);
 }finally{await f.close();}
});

test('portal recipient, tenant, publication, handling, reviewer and authority fences cover reads and staging retries',{timeout:60000},async()=>{
 const f=await workflowFixture();try{const q=await f.request(),r=await f.reserve(q),other=await f.member('client'),foreignTenant=randomUUID();await f.admin.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[foreignTenant,'Fictional isolated foreign tenant']);const foreign=await f.member('client',false,foreignTenant);
 for(const actor of [other.headers,foreign.headers]){assert.equal((await f.must<{items:unknown[]}>('/api/portal/evidence-requests',undefined,actor)).items.length,0);for(const path of [q.external,q.external+'/uploads/'+r.u.id,q.external+'/uploads/by-key/'+r.input.idempotencyKey])assert.equal((await f.call(path,undefined,actor)).statusCode,404);assert.equal((await f.call(q.external+'/responses',q.responseInput,actor)).statusCode,404);}
 const denied=async()=>{assert.equal((await f.must<{items:unknown[]}>('/api/portal/evidence-requests',undefined,f.client.headers)).items.length,0);for(const path of [q.external,q.external+'/uploads/'+r.u.id,q.external+'/uploads/by-key/'+r.input.idempotencyKey])assert.equal((await f.call(path,undefined,f.client.headers)).statusCode,404);for(const [path,input] of [[q.external+'/responses',q.responseInput],[q.external+'/uploads',r.input],[q.external+'/uploads/'+r.u.id+'/complete',{}],[q.external+'/uploads/'+r.u.id+'/cancel',{}],[q.external+'/uploads/'+r.u.id+'/chunk',{ordinal:0,contentBase64:r.bytes.toString('base64')}]] as const)assert.equal((await f.call(path,input,f.client.headers)).statusCode,404,path);};
 await f.handling('internal_only');await denied();assert.equal((await f.call(f.base+'/evidence-requests/'+q.g.id+'/publications',q.publish,f.reviewer.headers)).statusCode,409);
 await f.handling('existing_release_controls',f.reviewer.headers);await f.must(q.external,undefined,f.client.headers);await f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.reviewer.id]);await denied();
 await f.admin.query('INSERT INTO case_memberships VALUES($1,$2,$3,now())',[tenant,f.caseId,f.reviewer.id]);await f.must(q.external,undefined,f.client.headers);
 await f.must(f.base+'/authority',f.authority);await denied();
 }finally{await f.close();}
});

test('portal source-use requires separate review and re-review after response correction or withdrawal',{timeout:60000},async()=>{
 const f=await workflowFixture();try{const q=await f.request(),r=await f.reserve(q);await f.chunks(q,r);await f.must(q.external+'/uploads/'+r.u.id+'/complete',{},f.client.headers);const received=(await f.must<InternalEvidenceRequest>(f.base+'/evidence-requests/'+q.g.id)).receipts[0]!,sourceBase=f.base+'/manual-sources';
 const job=()=>f.call(f.base+'/integrity-jobs',{evidenceId:received.evidenceId,idempotencyKey:randomUUID(),kind:'utf8_line_index_v1'});
 assert.equal((await job()).statusCode,409);await f.must(f.base+'/integrity-jobs',{evidenceId:received.evidenceId,idempotencyKey:randomUUID(),kind:'original_sha256_v1'});
 const fields={url:received.sourceReference,publisher:'Fictional supplied-record attribution',retrievedAt:'2026-10-01T09:15:00+02:00',method:'Fictional recipient supply; not independently authenticated.',trustGrade:'unassessed',termsReference:'Fictional permission reference; no legal conclusion.',purpose:'Fictional acceptance exercise.',lawfulBasis:'Synthetic exercise only.',scope:'This one supplied fictional original.',retentionDays:30,minimisation:'No real data or external collection.',annotation:'Recipient assertions remain unverified; review limitations separately.'};
 assert.equal((await f.call(sourceBase,{id:randomUUID(),evidenceId:received.evidenceId,...fields,url:'inveos:portal-receipt:'+randomUUID()},f.investigator.headers)).statusCode,422);
 let source=await f.must<ManualSourceRecord>(sourceBase,{id:randomUUID(),evidenceId:received.evidenceId,...fields},f.investigator.headers);assert.equal((await job()).statusCode,409);
 const accept=async()=>{await f.must(sourceBase+'/'+source.id+'/review',{id:randomUUID(),expectedVersion:source.version,digest:source.digest,accepted:true,reason},f.reviewer.headers);};await accept();assert.equal((await job()).statusCode,409);
 const use=async(sequence:number)=>f.must(sourceBase+'/'+source.id+'/use-decisions',{id:randomUUID(),expectedSequence:sequence,sourceVersion:source.version,sourceDigest:source.digest,permission:'analysis_and_release',reason,validForHours:1},f.reviewer.headers);await use(0);
 // Opaque binary has no UTF-8 analysis profile; source permissions are independently observable.
 let permission=await f.must<{analysisAllowed:boolean;releaseAllowed:boolean}>(sourceBase+'/'+source.id+'/use-decisions');assert.equal(permission.analysisAllowed,true);assert.equal(permission.releaseAllowed,true);
 const correction={...q.responseInput,id:randomUUID(),expectedSequence:1,body:'Fictional corrected recipient explanation needing renewed metadata review.',reason};await f.must(q.external+'/responses',correction,f.client.headers);permission=await f.must(sourceBase+'/'+source.id+'/use-decisions');assert.equal(permission.analysisAllowed,false);
 source=await f.must<ManualSourceRecord>(sourceBase+'/'+source.id+'/revise',{...fields,expectedVersion:1,annotation:'Fictional new metadata reflects the corrected response explicitly.',reason},f.investigator.headers);await accept();await use(1);permission=await f.must(sourceBase+'/'+source.id+'/use-decisions');assert.equal(permission.analysisAllowed,true);
 await f.must(q.external+'/responses',{...correction,id:randomUUID(),expectedSequence:2,state:'withdrawn'},f.client.headers);permission=await f.must(sourceBase+'/'+source.id+'/use-decisions');assert.equal(permission.analysisAllowed,false);assert.equal(permission.releaseAllowed,false);assert.equal((await f.must<ManualSourceEntry[]>(sourceBase+'/'+source.id+'/history')).length,2);
 }finally{await f.close();}
});

test('portal finalisation rolls back bytes on audit failure and rechecks session after a real case-lock wait',{timeout:60000},async()=>{
 const f=await workflowFixture();try{const q=await f.request(),r=await f.reserve(q);await f.chunks(q,r);await f.admin.query(`CREATE FUNCTION reject_receipt_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='portal_evidence.file_received' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_receipt_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_receipt_audit()`);
 assert.equal((await f.call(q.external+'/uploads/'+r.u.id+'/complete',{},f.client.headers)).statusCode,500);assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,0);const folder=join(f.root,tenant,f.caseId);assert.deepEqual(await readdir(folder),[]);
 await f.admin.query('DROP TRIGGER reject_receipt_audit ON audit_events;DROP FUNCTION reject_receipt_audit()');await f.must(q.external+'/uploads/'+r.u.id+'/complete',{},f.client.headers);
 const lock=await f.admin.connect();await lock.query('BEGIN');await lock.query('SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,f.caseId]);
 try{const pending=f.call(q.external,undefined,f.client.headers);let waiting=false;for(let i=0;i<20;i++){if((await f.admin.query("SELECT 1 FROM pg_locks WHERE NOT granted AND pid<>pg_backend_pid()")).rowCount){waiting=true;break;}await delay(20);}assert.equal(waiting,true,'The API must actually wait on the case lock');await f.admin.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',[tenant,f.client.id]);await lock.query('COMMIT');assert.equal((await pending).statusCode,401);}finally{await lock.query('ROLLBACK');lock.release();}
 }finally{await f.close();}
});

test('portal publication corrections, terminal revocation, expiry and byte bounds preserve prior receipts',{timeout:60000},async()=>{
 const f=await workflowFixture();try{const q=await f.request();for(const size of [1,262144]){const r=await f.reserve(q,Buffer.alloc(size,66));await f.chunks(q,r);const u=await f.must<PortalUpload>(q.external+'/uploads/'+r.u.id+'/complete',{},f.client.headers);assert.equal(u.receipt!.byteLength,size);assert.equal(u.receipt!.sha256,sha(r.bytes));}
 const head=await f.must<InternalEvidenceRequest>(f.base+'/evidence-requests/'+q.g.id);assert.equal(head.receipts.length,2);
 const correction={id:randomUUID(),expectedVersion:1,title:'Fictional corrected public request',instructions:'Only the newly specified fictional item is requested after independent review.',reason};const d=await f.must<InternalEvidenceRequest>(f.base+'/evidence-requests/'+q.g.id+'/drafts',correction,f.investigator.headers);assert.equal((await f.must<PortalEvidenceRequest>(q.external,undefined,f.client.headers)).content.version,1);
 const decision={id:randomUUID(),expectedSequence:1,version:2,sha256:d.draft.sha256,action:'published',reason,confirmRecipientContent:true};await f.must(f.base+'/evidence-requests/'+q.g.id+'/publications',decision,f.reviewer.headers);const changed=await f.must<PortalEvidenceRequest>(q.external,undefined,f.client.headers);assert.equal(changed.content.version,2);assert.equal(changed.responses.length,0);assert.equal(changed.receipts.length,0);assert.equal((await f.call(q.external+'/uploads/'+head.receipts[0]!.uploadId,undefined,f.client.headers)).statusCode,404);
 await f.must(f.base+'/evidence-requests/'+q.g.id+'/publications',{...decision,id:randomUUID(),expectedSequence:2,action:'revoked'},f.reviewer.headers);assert.equal((await f.call(q.external,undefined,f.client.headers)).statusCode,404);assert.equal((await f.call(f.base+'/evidence-requests/'+q.g.id+'/publications',{...decision,id:randomUUID(),expectedSequence:3},f.reviewer.headers)).statusCode,409);assert.equal((await f.must<InternalEvidenceRequest>(f.base+'/evidence-requests/'+q.g.id)).receipts.length,2);
 const expiring=await f.request(1500);await delay(Math.max(0,Date.parse(expiring.g.expiresAt)-Date.now()+30));assert.equal((await f.call(expiring.external,undefined,f.client.headers)).statusCode,404);assert.equal((await f.call(expiring.external+'/responses',expiring.responseInput,f.client.headers)).statusCode,404);
 }finally{await f.close();}
});
