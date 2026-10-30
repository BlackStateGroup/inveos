/** Immutable historical research lineage; never an assertion of present permission. */
import type {PoolClient} from 'pg';
import type {ResearchProvenance,ResearchReceipt,ResearchRequest} from '@inveos/contracts';
import {ApiError} from './errors.js';
import {transcriptHash} from './transcript-findings.js';
import {profileDigestFor} from './connector-policy.js';
import {researchTarget} from './research-adapters.js';
export async function researchProvenance(c:PoolClient,tenantId:string,caseId:string,evidenceId:string):Promise<ResearchProvenance|undefined>{
 const found=(await c.query('SELECT 1 FROM research_captures WHERE tenant_id=$1 AND case_id=$2 AND evidence_id=$3',[tenantId,caseId,evidenceId])).rowCount;if(!found)return;
 const rows=(await c.query(`SELECT x.receipt,x.digest,x.run_id,e.digest original_digest,e.byte_length,e.source_time,e.received_time,e.authority_id,e.authority_version,j.status,j.execution_mode,
 v.snapshot request,v.digest request_digest,to_jsonb(ar) case_authority,to_jsonb(p)-'request_hash' source_policy,to_jsonb(pr)-'request_hash' policy_review,jsonb_build_object('endpoint_scope',ps.endpoint_scope,'credential_scope',ps.credential_scope) policy_scope
 FROM research_captures x JOIN research_runs j ON j.tenant_id=x.tenant_id AND j.case_id=x.case_id AND j.id=x.run_id
 JOIN evidence e ON e.tenant_id=x.tenant_id AND e.case_id=x.case_id AND e.id=x.evidence_id
 JOIN research_request_versions v ON v.tenant_id=j.tenant_id AND v.case_id=j.case_id AND v.request_id=j.request_id AND v.version=j.request_version
 JOIN authority_records ar ON ar.tenant_id=v.tenant_id AND ar.case_id=v.case_id AND ar.id=v.authority_id AND ar.version=v.authority_version
 JOIN connector_policy_versions p ON p.tenant_id=v.tenant_id AND p.adapter_id=v.adapter_id AND p.version=v.policy_version
 JOIN connector_policy_reviews pr ON pr.tenant_id=p.tenant_id AND pr.adapter_id=p.adapter_id AND pr.version=p.version
 JOIN connector_policy_scopes ps ON ps.tenant_id=p.tenant_id AND ps.adapter_id=p.adapter_id AND ps.version=p.version
 WHERE x.tenant_id=$1 AND x.case_id=$2 AND x.evidence_id=$3`,[tenantId,caseId,evidenceId])).rows;
 if(rows.length!==1)throw new ApiError(409,'Research capture lineage is incomplete.');
 const row=rows[0]!,r=row.receipt as ResearchReceipt,q=row.request as ResearchRequest,p=row.source_policy,review=row.policy_review;
 if(row.status!=='succeeded'||r.tenantId!==tenantId||r.caseId!==caseId||r.runId!==row.run_id||q.tenantId!==tenantId||q.caseId!==caseId||r.requestId!==q.requestId||r.requestVersion!==q.version||r.requestDigest!==q.digest||q.digest!==row.request_digest.trim()||transcriptHash(Object.fromEntries(Object.entries(q).filter(([k])=>k!=='digest')))!==q.digest||r.adapterId!==q.adapterId||r.target!==q.target||r.url!==researchTarget(q.adapterId,q.target,q.endpointScope)||r.endpointScope!==q.endpointScope||q.endpointScope!==row.policy_scope.endpoint_scope||r.credentialScope!==q.credentialScope||q.credentialScope!==row.policy_scope.credential_scope||r.authorityVersion!==row.authority_version||q.authorityId!==row.authority_id||q.authorityVersion!==row.authority_version||r.originalSha256!==row.original_digest.trim()||r.byteLength!==row.byte_length||r.sourceTime!==row.source_time||r.receivedAt!==new Date(row.received_time).toISOString()||r.profileDigest!==profileDigestFor(q.adapterId)||q.profileDigest!==r.profileDigest||r.policyVersion!==p.version||q.policyVersion!==p.version||p.adapter_id!==q.adapterId||review.accepted!==true||review.reviewer_id===p.proposed_by||transcriptHash(r)!==row.digest.trim()||((r.captureMode==='fictional_transport')!==(row.execution_mode!=='supplied'))||(row.execution_mode==='lei_transport'&&q.adapterId!=='gleif_lei_v1')||(row.execution_mode==='rdap_transport'&&q.adapterId!=='rdap_domain_v1'))throw new ApiError(409,'Research receipt does not match original and historical permission.');
 const payload={schemaVersion:'inveos.research-provenance.v1' as const,receipt:r,receiptSha256:row.digest.trim(),request:q,caseAuthority:row.case_authority,sourcePolicy:p,policyReview:review,policyScope:row.policy_scope};return {payload,sha256:transcriptHash(payload)};
}
