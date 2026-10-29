import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {inTransaction} from './db.js';
import {ApiError} from './errors.js';
import {validateDispatch} from './integrity-jobs.js';

type Recovery = {tenantId:string;caseId:string;actorId:string;quiesced:true;reason:string};
/** Trusted operator entry point. Stop API/worker writers before using it; never exposed over HTTP. */
export async function retireRestoredJobs(pool:Pool,input:Recovery,limit=25){
 validateDispatch(input,limit);
 if(input.quiesced!==true||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.actorId)||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>1000||/[\u0000-\u001f\u007f]/u.test(input.reason))throw new Error('Explicit quiesced recovery scope and reason required.');
 return inTransaction(pool,async client=>{
  await client.query("SET LOCAL lock_timeout = '2s'");await client.query("SET LOCAL statement_timeout = '5s'");
  const member=await client.query(`SELECT c.id FROM cases c JOIN case_memberships cm ON cm.tenant_id=c.tenant_id AND cm.case_id=c.id
   JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id
   WHERE c.tenant_id=$1 AND c.id=$2 AND cm.user_id=$3 AND m.role='reviewer' FOR UPDATE OF c`,[input.tenantId,input.caseId,input.actorId]);
  if(!member.rowCount)throw new ApiError(403,'Recovery requires a currently assigned reviewer.');
  const selected=await client.query(`SELECT id,attempt FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND status IN ('queued','running') ORDER BY created_at,id LIMIT $3 FOR UPDATE`,[input.tenantId,input.caseId,limit]);
  for(const row of selected.rows){
   await client.query(`UPDATE integrity_jobs SET status='cancelled',failure_code='restore_recovery',lease_token=NULL,lease_until=NULL,lease_deadline=NULL,finished_at=clock_timestamp()
    WHERE tenant_id=$1 AND case_id=$2 AND id=$3`,[input.tenantId,input.caseId,row.id]);
   await client.query(`INSERT INTO integrity_job_events(tenant_id,case_id,job_id,status,attempt,failure_code) VALUES($1,$2,$3,'cancelled',$4,'restore_recovery')`,[input.tenantId,input.caseId,row.id,row.attempt]);
   await client.query(`INSERT INTO audit_events(tenant_id,case_id,id,actor_user_id,action,entity_type,entity_id,summary,metadata)
    VALUES($1,$2,$3,$4,'job.retired_after_restore','integrity_job',$5,'Restored work retired before reopening access',$6::jsonb)`,[input.tenantId,input.caseId,randomUUID(),input.actorId,row.id,JSON.stringify({reason:input.reason,attempt:row.attempt,quiesced:true})]);
  }
  const more=await client.query("SELECT 1 FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND status IN ('queued','running') LIMIT 1",[input.tenantId,input.caseId]);
  return {retired:selected.rows.length,moreRemaining:!!more.rowCount};
 });
}
