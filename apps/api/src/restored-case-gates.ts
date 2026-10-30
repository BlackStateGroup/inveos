import type {PoolClient} from 'pg';
import {ApiError} from './errors.js';

// The caller's cases alias is c. A new authority alone does not resume restored work:
// a fresh current-reviewer handling decision under that authority is also required.
export const restoredCaseWorkEligibility=`NOT EXISTS(SELECT 1 FROM restored_case_quarantines rq
 WHERE rq.tenant_id=c.tenant_id AND rq.case_id=c.id
 AND rq.generation=(SELECT max(rh.generation) FROM restored_case_quarantines rh WHERE rh.tenant_id=c.tenant_id AND rh.case_id=c.id)
 AND (c.authority_version IS NULL OR c.authority_version<=coalesce(rq.authority_version,0)
 OR NOT EXISTS(SELECT 1 FROM restored_case_quarantine_batches rb WHERE rb.tenant_id=rq.tenant_id AND rb.case_id=rq.case_id AND rb.quarantine_id=rq.id AND NOT rb.more_remaining)
 OR NOT EXISTS(SELECT 1 FROM case_handling_events h JOIN memberships m ON m.tenant_id=h.tenant_id AND m.user_id=h.actor_id
 JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id AND cm.case_id=h.case_id
 WHERE h.tenant_id=c.tenant_id AND h.case_id=c.id AND h.version>rq.handling_version AND h.authority_version=c.authority_version
 AND h.version=(SELECT max(hv.version) FROM case_handling_events hv WHERE hv.tenant_id=c.tenant_id AND hv.case_id=c.id) AND m.role='reviewer')))`;

export async function latestRestoredQuarantine(c:PoolClient,tenantId:string,caseId:string){
 return (await c.query(`SELECT q.*,b.batch,b.more_remaining FROM restored_case_quarantines q
 LEFT JOIN LATERAL(SELECT batch,more_remaining FROM restored_case_quarantine_batches WHERE tenant_id=q.tenant_id AND case_id=q.case_id AND quarantine_id=q.id ORDER BY batch DESC LIMIT 1)b ON true
 WHERE q.tenant_id=$1 AND q.case_id=$2 ORDER BY q.generation DESC LIMIT 1`,[tenantId,caseId])).rows[0];
}
// Caller holds the case lock. Missing/partial recovery state is never completion.
export async function assertRestoredRetirementComplete(c:PoolClient,tenantId:string,caseId:string){
 const q=await latestRestoredQuarantine(c,tenantId,caseId);
 if(q&&(!q.batch||q.more_remaining!==false))throw new ApiError(409,'Restored-case quarantine retirement is incomplete. Keep writers stopped and continue the exact operator request.');
}
export async function assertRestoredCaseWork(c:PoolClient,tenantId:string,caseId:string){
 const r=await c.query(`SELECT ${restoredCaseWorkEligibility} allowed FROM cases c WHERE tenant_id=$1 AND id=$2`,[tenantId,caseId]);
 if(r.rows[0]?.allowed!==true)throw new ApiError(409,'Restored case requires completed quarantine retirement, explicit reopen, new authority and a fresh handling review under that authority.');
}
