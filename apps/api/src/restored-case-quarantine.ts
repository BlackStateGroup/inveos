import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {inTransaction} from './db.js';
import {findCase,writeAudit,type Actor} from './app.js';
import {ApiError} from './errors.js';
import {caseSharingState,recordCaseHandling} from './case-handling.js';
import {appendCaseStage} from './case-lifecycle.js';
import {latestRestoredQuarantine} from './restored-case-gates.js';
import {retireRestoredJobsInTransaction} from './recover-jobs.js';
import {cancelCollectorJob} from './collector-cancellation.js';
import {validateDispatch} from './integrity-jobs.js';

export type RestoredCaseRequest={tenantId:string;caseId:string;actorId:string;requestId:string;backupSha256:string;reason:string;quiesced:true;limit:number;batch:number};
export type RestoredCaseReceipt={schemaVersion:'inveos.restored-case-quarantine.v1';tenantId:string;caseId:string;requestId:string;actorId:string;backupSha256:string;reason:string;quiesced:true;authorityVersion:number|null;handlingVersion:number;handlingId:string;handlingSha256:string;lifecycleVersion:number;lifecycleState:string;quarantinedAt:string;batch:number;limit:number;retired:{integrityJobIds:string[];collectionJobIds:string[];researchRunIds:string[]};moreRemaining:boolean;nextBatch:number|null;recordedAt:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// This digest identifies only the operator request; handling uses its canonical writer.
function requestDigest(q:RestoredCaseRequest){return createHash('sha256').update(JSON.stringify({tenantId:q.tenantId,caseId:q.caseId,actorId:q.actorId,requestId:q.requestId,backupSha256:q.backupSha256,reason:q.reason,quiesced:q.quiesced,limit:q.limit})).digest('hex');}
export function validateRestoredCaseRequest(q:RestoredCaseRequest){
 validateDispatch(q,q.limit);
 if(![q.tenantId,q.caseId,q.actorId,q.requestId].every(id=>typeof id==='string'&&uuid.test(id))||q.quiesced!==true||typeof q.backupSha256!=='string'||!/^[a-f0-9]{64}$/.test(q.backupSha256)||typeof q.reason!=='string'||q.reason.trim().length<10||q.reason.length>1000||/[\u0000-\u001f\u007f]/u.test(q.reason)||Buffer.from(q.reason).toString('utf8')!==q.reason||!Number.isInteger(q.batch)||q.batch<1||q.batch>10000)throw new Error('Explicit tenant/case/current reviewer, stable request, SHA256 backup fingerprint, recovery reason, quiescence and bounded batch are required.');
}
async function pending(c:PoolClient,q:RestoredCaseRequest){
 return !!(await c.query(`SELECT 1 FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND status IN ('queued','running')
 UNION ALL SELECT 1 FROM collection_jobs WHERE tenant_id=$1 AND case_id=$2 AND status IN ('queued','running')
 UNION ALL SELECT 1 FROM research_runs WHERE tenant_id=$1 AND case_id=$2 AND status IN ('queued','running') LIMIT 1`,[q.tenantId,q.caseId])).rowCount;
}
/** Trusted, explicitly quiesced non-production operator entry point; no HTTP route.
 * Each batch is atomic with its audit and exact receipt; a missing next batch is not completion.
 */
export async function quarantineRestoredCase(pool:Pool,q:RestoredCaseRequest):Promise<RestoredCaseReceipt>{
 validateRestoredCaseRequest(q);
 return inTransaction(pool,async c=>{
  await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");
  // Lock case first, then recheck role in a fresh statement: a waiting SELECT can
  // otherwise retain a snapshot of membership revoked before the lock was obtained.
  if(!(await c.query('SELECT id FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[q.tenantId,q.caseId])).rowCount)throw new ApiError(403,'Recovery requires a current assigned case reviewer.');
  const member=(await c.query(`SELECT u.display_name FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id JOIN users u ON u.id=m.user_id
   WHERE m.tenant_id=$1 AND cm.case_id=$2 AND m.user_id=$3 AND m.role='reviewer'`,[q.tenantId,q.caseId,q.actorId])).rows[0];
  if(!member)throw new ApiError(403,'Recovery requires a current assigned case reviewer.');
  const a:Actor={tenantId:q.tenantId,userId:q.actorId,displayName:member.display_name,role:'reviewer',tokenHash:'',csrfHash:''};
  const kase=await findCase(c,a,q.caseId,true),digest=requestDigest(q);
  let saved=(await c.query('SELECT * FROM restored_case_quarantines WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[q.tenantId,q.caseId,q.requestId])).rows[0];
  const head=await latestRestoredQuarantine(c,q.tenantId,q.caseId);
  if(saved){
   if(saved.request_hash.trim()!==digest||saved.actor_id!==q.actorId||head?.id!==q.requestId)throw new ApiError(409,'Recovery identity changed or a newer quarantine exists.');
   const old=(await c.query('SELECT receipt FROM restored_case_quarantine_batches WHERE tenant_id=$1 AND case_id=$2 AND quarantine_id=$3 AND batch=$4',[q.tenantId,q.caseId,q.requestId,q.batch])).rows[0];
   if(old)return old.receipt as RestoredCaseReceipt;
   if(!head?.batch||head.more_remaining!==true||q.batch!==head.batch+1)throw new ApiError(409,'Recovery continuation is incomplete, already finished, or out of sequence.');
   const handling=await caseSharingState(c,q.tenantId,q.caseId);
   if(kase.lifecycle_version!==saved.lifecycle_version||kase.lifecycle_state!==saved.lifecycle_state||kase.authority_version!==saved.authority_version||handling.current?.version!==saved.handling_version||handling.current?.sharing!=='internal_only')throw new ApiError(409,'Quarantine gates changed during retirement. Keep all writers stopped and inspect recovery state.');
  }else{
   if(q.batch!==1||(head&&head.more_remaining!==false))throw new ApiError(409,'Start at batch 1; a prior partial recovery must be completed under its exact identity.');
   const handling=await caseSharingState(c,q.tenantId,q.caseId);
   const held=await recordCaseHandling(c,a,q.caseId,kase,{id:randomUUID(),expectedVersion:handling.current?.version??0,expectedAuthorityVersion:kase.authority_version,tier:handling.current?.tier??'restricted',sharing:'internal_only',instructions:'Restored case quarantine: keep writers stopped until retirement completes. Reconcile decisions lost after the backup; explicitly reopen, approve new authority and record fresh handling before work. Existing release and source reviews remain independent.',reason:q.reason},writeAudit);
   const lifecycleVersion=['Closed','Archived'].includes(kase.lifecycle_state)?kase.lifecycle_version:await appendCaseStage(c,a,q.caseId,kase,'Closed',q.reason,'investigator_transition');
   const lifecycleState=kase.lifecycle_state==='Archived'?'Archived':'Closed';
   if(lifecycleVersion!==kase.lifecycle_version)await writeAudit(c,a,q.caseId,'case.stage_changed','case',q.caseId,'Reviewer closed restored case collection',{from:kase.lifecycle_state,to:lifecycleState,version:lifecycleVersion,recoveryRequestId:q.requestId});
   saved=(await c.query(`INSERT INTO restored_case_quarantines(tenant_id,case_id,id,actor_id,reason,backup_sha256,quiesced,request_hash,batch_limit,authority_version,handling_version,lifecycle_version,lifecycle_state)
    VALUES($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12) RETURNING *`,[q.tenantId,q.caseId,q.requestId,q.actorId,q.reason,q.backupSha256,digest,q.limit,kase.authority_version,held.version,lifecycleVersion,lifecycleState])).rows[0]!;
  }
  const jobs=await retireRestoredJobsInTransaction(c,q,q.limit),retired={integrityJobIds:jobs.jobIds,collectionJobIds:[] as string[],researchRunIds:[] as string[]};
  let remaining=q.limit-jobs.retired;
  for(const kind of ['collection','research'] as const){
   if(!remaining)break;
   const table=kind==='collection'?'collection_jobs':'research_runs';
   const rows=(await c.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND case_id=$2 AND status IN ('queued','running') ORDER BY requested_at,id LIMIT $3 FOR UPDATE`,[q.tenantId,q.caseId,remaining])).rows;
   for(const row of rows){
    await cancelCollectorJob(c,q,kind,row.id,'restore_recovery');
    await writeAudit(c,a,q.caseId,'job.retired_after_restore',kind==='collection'?'collection_job':'research_run',row.id,'Restored collector work retired before reopening access',{reason:q.reason,quiesced:true,recoveryRequestId:q.requestId,batch:q.batch});
    (kind==='collection'?retired.collectionJobIds:retired.researchRunIds).push(row.id);remaining--;
   }
  }
  const moreRemaining=await pending(c,q),handling=(await c.query('SELECT id,sha256 FROM case_handling_events WHERE tenant_id=$1 AND case_id=$2 AND version=$3',[q.tenantId,q.caseId,saved.handling_version])).rows[0];
  if(!handling)throw new ApiError(409,'Quarantine handling receipt is missing.');
  if(moreRemaining&&q.batch===10000)throw new ApiError(409,'Recovery continuation bound reached. Keep writers stopped; no incomplete final receipt is committed.');
  const at=(await c.query('SELECT clock_timestamp() at')).rows[0].at as Date;
  const receipt:RestoredCaseReceipt={schemaVersion:'inveos.restored-case-quarantine.v1',tenantId:q.tenantId,caseId:q.caseId,requestId:q.requestId,actorId:q.actorId,backupSha256:q.backupSha256,reason:q.reason,quiesced:true,authorityVersion:saved.authority_version,handlingVersion:saved.handling_version,handlingId:handling.id,handlingSha256:handling.sha256.trim(),lifecycleVersion:saved.lifecycle_version,lifecycleState:saved.lifecycle_state,quarantinedAt:saved.recorded_at.toISOString(),batch:q.batch,limit:q.limit,retired,moreRemaining,nextBatch:moreRemaining?q.batch+1:null,recordedAt:at.toISOString()};
  await c.query('INSERT INTO restored_case_quarantine_batches(tenant_id,case_id,quarantine_id,batch,more_remaining,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[q.tenantId,q.caseId,q.requestId,q.batch,moreRemaining,JSON.stringify(receipt),at]);
  await writeAudit(c,a,q.caseId,'case.restored_quarantined','restored_case_quarantine',q.requestId,'Restored case held internal-only; retirement receipt retained',{backupSha256:q.backupSha256,reason:q.reason,quiesced:true,batch:q.batch,retired,moreRemaining,handlingVersion:saved.handling_version,lifecycleVersion:saved.lifecycle_version});
  return receipt;
 });
}
