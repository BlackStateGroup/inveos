import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app.js';
import {createPool,runMigrations} from '../src/db.js';
import {encryptedOriginalStore,type OriginalStore} from '../src/original-encryption.js';
import {runIntegrityJob} from '../src/integrity-jobs.js';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

test('real API and durable worker preserve encrypted originals through key rotation, restart, restore and missing-key denial',{timeout:30000},async()=>{
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminUrl,'Disposable PostgreSQL required');assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='encrypted_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,'public',2);await runMigrations(admin,schema);const pool=createPool(database,schema,4);
 const root=await mkdtemp(join(tmpdir(),'inveos-api-cipher-')),tenant='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',origin='http://localhost:5173',old=randomBytes(32),next=randomBytes(32);
 let store:OriginalStore=encryptedOriginalStore(join(root,'objects'),'old',{old});const make=()=>createApp({pool,storageRoot:store,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:user,sessionTtlSeconds:3600});let app=await make();
 try{
  const start=await app.inject({method:'POST',url:'/api/session/start',headers:{origin},payload:{}});assert.equal(start.statusCode,200,start.body);const cookies=start.headers['set-cookie'];const headers={origin,'x-csrf-token':start.json().csrf,cookie:(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(c=>c!.split(';')[0]).join('; ')};
  const request=(method:'GET'|'POST',url:string,payload?:object)=>app.inject({method,url,headers,...(payload?{payload}:{})});const ok=async(method:'GET'|'POST',url:string,payload?:object)=>{const r=await request(method,url,payload);assert.equal(r.statusCode,200,r.body);return r.json();};
  const kase=await ok('POST','/api/cases',{title:'Fictional encrypted custody case',client:'Fictional client',scope:'Fictional supplied records only',jurisdiction:'England and Wales'}),base='/api/cases/'+kase.id;
  await ok('POST',base+'/authority',{purpose:'Fictional encrypted custody acceptance',lawfulBasis:'Synthetic no-personal-data lab',scope:'Fictional supplied records only',retentionDays:30,minimisation:'No real data'});
  const original=Buffer.from('FICTIONAL: Atlas Demo records 100 percent.\n'),evidence=await ok('POST',base+'/evidence',{filename:'fictional-encrypted.txt',text:original.toString(),expectedSha256:sha(original),sourceTime:'2026-10-25T00:00:00Z',method:'Fictional supplied original',idempotencyKey:randomUUID()});
  const row=(await pool.query('SELECT object_path,digest FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[tenant,kase.id,evidence.id])).rows[0];assert.equal(row.digest,sha(original));assert.match(row.object_path,/\.txt\.enc$/);const ciphertext=await readFile(join(root,'objects',row.object_path));assert.equal(ciphertext.includes(original),false);
  const job=await ok('POST',base+'/integrity-jobs',{evidenceId:evidence.id,kind:'original_sha256_v1',idempotencyKey:randomUUID()});assert.equal((await runIntegrityJob(pool,store,{tenantId:tenant,caseId:kase.id,jobId:job.id}))?.status,'succeeded');
  const claim=await ok('POST',base+'/claims',{evidenceId:evidence.id,text:'The supplied fictional source states 100 percent; no ownership truth is certified.',quote:'100 percent'});await ok('POST',base+'/claims/'+claim.id+'/review',{accepted:true,reason:'Fictional exact source quote compared.'});
  const report=await ok('GET',base+'/report');assert.equal(report.findings[0].source.contentBase64,original.toString('base64'));
  await app.close();store=encryptedOriginalStore(join(root,'objects'),'next',{old,next});app=await make();const restarted=await ok('GET',base+'/report');assert.deepEqual(restarted,report);assert.deepEqual(await readFile(join(root,'objects',row.object_path)),ciphertext);
  const binary=Buffer.from([0,1,2,255,0,13,10]),input={filename:'fictional-binary.bin',contentBase64:binary.toString('base64'),expectedSha256:sha(binary),sourceTime:'2026-10-26T00:00:00Z',method:'Fictional byte fixture',idempotencyKey:randomUUID()};const received=await ok('POST',base+'/evidence/binary',input);assert.deepEqual(await ok('POST',base+'/evidence/binary',input),received);
  const binaryRow=(await pool.query('SELECT object_path FROM evidence WHERE id=$1',[received.id])).rows[0];assert.match(binaryRow.object_path,/\.bin\.enc$/);assert.equal((await readFile(join(root,'objects',binaryRow.object_path))).includes(binary),false);
  await app.close();await cp(join(root,'objects'),join(root,'restored'),{recursive:true});store=encryptedOriginalStore(join(root,'restored'),'next',{old,next});app=await make();assert.deepEqual(await ok('GET',base+'/report'),report);
  const deniedJob=await ok('POST',base+'/integrity-jobs',{evidenceId:evidence.id,kind:'utf8_line_index_v1',idempotencyKey:randomUUID()});
  await app.close();store=encryptedOriginalStore(join(root,'restored'),'next',{next});app=await make();assert.equal((await request('GET',base+'/report')).statusCode,409);
  const failed=await runIntegrityJob(pool,store,{tenantId:tenant,caseId:kase.id,jobId:deniedJob.id});assert.equal(failed?.status,'failed');assert.equal(failed?.failureCode,'original_unavailable');assert.equal((await pool.query('SELECT count(*)::int AS n FROM text_derivatives WHERE job_id=$1',[deniedJob.id])).rows[0].n,0);
  const newKeyJob=await ok('POST',base+'/integrity-jobs',{evidenceId:received.id,kind:'original_sha256_v1',idempotencyKey:randomUUID()});assert.equal((await runIntegrityJob(pool,store,{tenantId:tenant,caseId:kase.id,jobId:newKeyJob.id}))?.status,'succeeded');
  await app.close();store=encryptedOriginalStore(join(root,'restored'),'next',{old,next});app=await make();await writeFile(join(root,'restored',row.object_path),original);assert.equal((await request('GET',base+'/report')).statusCode,409);
  assert.equal((await pool.query('SELECT digest FROM evidence WHERE id=$1',[evidence.id])).rows[0].digest,sha(original));
 }finally{await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});old.fill(0);next.fill(0);}
});
