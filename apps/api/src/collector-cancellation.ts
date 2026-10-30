import type {PoolClient} from 'pg';
import {ApiError} from './errors.js';
// Shared by ordinary explicit cancellation and restored-case retirement. The caller
// holds the case lock; existing database guards retain immutable job event history.
export async function cancelCollectorJob(c:PoolClient,scope:{tenantId:string;caseId:string},kind:'collection'|'research',id:string,code:'cancelled'|'restore_recovery'='cancelled'){
 const table=kind==='collection'?'collection_jobs':'research_runs';
 const keys=[scope.tenantId,scope.caseId,id];
 const job=(await c.query(`SELECT status FROM ${table} WHERE tenant_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`,keys)).rows[0];
 if(!job)throw new ApiError(404,'Collector job not found.');
 if(job.status==='cancelled')return;
 if(!['queued','running'].includes(job.status))throw new ApiError(409,'Completed collector work cannot be cancelled.');
 await c.query(`UPDATE ${table} SET status='cancelled',failure_code=$4,lease_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE tenant_id=$1 AND case_id=$2 AND id=$3`,[...keys,code]);
}
