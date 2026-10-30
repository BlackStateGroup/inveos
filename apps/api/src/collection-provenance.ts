/** Immutable historical collection provenance. This does not authorise current collection/use. */
import type {PoolClient} from 'pg';
import type {CollectionProvenance,CollectionReceipt} from '@inveos/contracts';
import {ApiError} from './errors.js';
import {transcriptHash} from './transcript-findings.js';
import {connectorProfileDigest} from './connector-policy.js';
export async function collectionProvenance(c:PoolClient,tenantId:string,caseId:string,evidenceId:string):Promise<CollectionProvenance|undefined>{
 const rows=(await c.query(`SELECT x.receipt,x.digest,x.job_id,e.digest original_digest,e.byte_length,e.source_time,e.received_time,e.authority_id,e.authority_version,
 j.status,to_jsonb(au)-'request_hash' authorisation,to_jsonb(ar) case_authority,to_jsonb(p)-'request_hash' source_policy,to_jsonb(pr)-'request_hash' policy_review
 FROM collection_captures x JOIN collection_jobs j ON j.tenant_id=x.tenant_id AND j.case_id=x.case_id AND j.id=x.job_id
 JOIN evidence e ON e.tenant_id=x.tenant_id AND e.case_id=x.case_id AND e.id=x.evidence_id
 JOIN collection_authorisations au ON au.tenant_id=j.tenant_id AND au.case_id=j.case_id AND au.id=j.authorisation_id
 JOIN authority_records ar ON ar.tenant_id=au.tenant_id AND ar.case_id=au.case_id AND ar.id=au.authority_id AND ar.version=au.authority_version
 JOIN connector_policy_versions p ON p.tenant_id=au.tenant_id AND p.adapter_id=au.adapter_id AND p.version=au.policy_version
 JOIN connector_policy_reviews pr ON pr.tenant_id=p.tenant_id AND pr.adapter_id=p.adapter_id AND pr.version=p.version
 WHERE x.tenant_id=$1 AND x.case_id=$2 AND x.evidence_id=$3`,[tenantId,caseId,evidenceId])).rows;
 if(!rows.length){if((await c.query('SELECT 1 FROM collection_captures WHERE tenant_id=$1 AND case_id=$2 AND evidence_id=$3',[tenantId,caseId,evidenceId])).rowCount)throw new ApiError(409,'Collection provenance is incomplete.');return;}
 const row=rows[0]!,r=row.receipt as CollectionReceipt,a=row.authorisation,p=row.source_policy,review=row.policy_review;
 if(rows.length!==1||row.status!=='succeeded'||r.tenantId!==tenantId||r.caseId!==caseId||r.jobId!==row.job_id||r.authorisationId!==a.id||r.authorityVersion!==row.authority_version||a.authority_id!==row.authority_id||a.authority_version!==row.authority_version||r.originalSha256!==row.original_digest.trim()||r.byteLength!==row.byte_length||r.sourceTime!==row.source_time||r.receivedAt!==new Date(row.received_time).toISOString()||r.profileDigest!==connectorProfileDigest||r.policyVersion!==p.version||a.policy_version!==p.version||a.company_number!==r.companyNumber||review.accepted!==true||review.reviewer_id===p.proposed_by||transcriptHash(r)!==row.digest.trim())throw new ApiError(409,'Collection receipt does not match the cited original and historical authority.');
 const payload={schemaVersion:'inveos.collection-provenance.v1' as const,receipt:r,receiptSha256:row.digest.trim(),authorisation:a,caseAuthority:row.case_authority,sourcePolicy:p,policyReview:review};
 return {payload,sha256:transcriptHash(payload)};
}
