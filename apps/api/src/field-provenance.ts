import type {PoolClient} from 'pg';
import type {FieldAcceptance,FieldManifest,FieldProvenance,FieldSyncAuthority,FieldHistoricalGrant,ReportDraft} from '@inveos/contracts';
import {ApiError} from './errors.js';
import {fieldManifestHash} from './field-capture.js';
import {grantAuthority,syncEqual} from './field-authority.js';
import {transcriptHash as hash} from './transcript-findings.js';
const stamp=(v:Date|string)=>new Date(v).toISOString();
function fail():never{throw new ApiError(409,'Field capture and historical recovery provenance differ.');}
export async function reportFieldProvenance(c:PoolClient,tenantId:string,caseId:string,report:ReportDraft):Promise<FieldProvenance[]>{
 const ids=[...new Set([...report.findings.map(f=>f.source.id),...(report.documentFindings??[]).map(f=>f.source.id),...(report.transcriptFindings??[]).map(f=>f.claim.source.id),...(report.speechFindings??[]).map(f=>f.source.id),...(report.tikaFindings??[]).map(f=>f.source.id)])].sort();
 const values:FieldProvenance[]=[];
 for(const evidenceId of ids){
  const row=(await c.query(`SELECT f.*,e.digest,e.byte_length,e.filename,e.source_time,e.method,e.received_time original_received_at,e.authority_id accepted_authority_id,e.authority_version accepted_authority_version,r.acceptance,r.recovery_id FROM field_captures f JOIN evidence e ON e.tenant_id=f.tenant_id AND e.case_id=f.case_id AND e.id=f.evidence_id LEFT JOIN field_sync_receipts r ON r.tenant_id=f.tenant_id AND r.case_id=f.case_id AND r.capture_id=f.id WHERE f.tenant_id=$1 AND f.case_id=$2 AND f.evidence_id=$3`,[tenantId,caseId,evidenceId])).rows[0];if(!row)continue;
  const m=row.manifest as FieldManifest,acceptance=(row.acceptance??null) as FieldAcceptance|null,receivedAt=stamp(row.received_at);
  if(m.id!==row.id||m.deviceId!==row.device_id||m.authorityId!==row.authority_id||m.authorityVersion!==row.authority_version||fieldManifestHash(m)!==row.manifest_sha256.trim()||m.filename!==row.filename||m.byteLength!==row.byte_length||m.sourceTime!==row.source_time||m.expectedSha256!==row.digest.trim()||m.method!==row.method||m.scopeConfirmed!==true||new Date(receivedAt)<new Date(row.original_received_at))fail();
  async function historicalGrant(sync:FieldSyncAuthority|null|undefined):Promise<FieldHistoricalGrant|null>{
   if(!sync)return null;
   const grant=(await c.query(`SELECT g.*,d.state device_state FROM field_case_grants g JOIN field_device_events d ON d.tenant_id=g.tenant_id AND d.user_id=g.user_id AND d.device_id=g.device_id AND d.version=g.device_version WHERE g.tenant_id=$1 AND g.case_id=$2 AND g.user_id=$3 AND g.id=$4`,[tenantId,caseId,row.user_id,sync.grantId])).rows[0];
   if(!grant||grant.state!=='granted'||grant.device_state!=='active'||!syncEqual(grantAuthority(grant),sync))fail();return {authority:grantAuthority(grant),userId:row.user_id,state:'granted',recordedAt:stamp(grant.recorded_at),expiresAt:stamp(grant.expires_at)};
  }
  const captureGrant=await historicalGrant(m.sync),acceptanceGrant=await historicalGrant(acceptance?.authority);let recovery:FieldProvenance['payload']['recovery']=null;
  if(m.sync&&(m.sync.deviceId!==m.deviceId||m.sync.authorityId!==m.authorityId||m.sync.authorityVersion!==m.authorityVersion))fail();
  if(acceptance){
   if(acceptance.receivedAt!==receivedAt||(row.recovery_id??null)!==acceptance.recoveryId)fail();
   if(acceptance.authority){if(acceptance.authority.authorityId!==row.accepted_authority_id||acceptance.authority.authorityVersion!==row.accepted_authority_version||!acceptanceGrant||Date.parse(acceptanceGrant.recordedAt)>Date.parse(receivedAt)||Date.parse(acceptanceGrant.expiresAt)<=Date.parse(receivedAt))fail();}
   if(acceptance.recoveryId){
    const q=(await c.query(`SELECT q.*,r.id review_id,r.decision,r.reviewer_id,r.recorded_at reviewed_at FROM field_recovery_requests q JOIN field_recovery_reviews r ON r.tenant_id=q.tenant_id AND r.case_id=q.case_id AND r.request_id=q.id WHERE q.tenant_id=$1 AND q.case_id=$2 AND q.id=$3`,[tenantId,caseId,acceptance.recoveryId])).rows[0];
    if(!q||q.user_id!==row.user_id||q.capture_id!==m.id||q.source_device_id!==m.deviceId||q.manifest_sha256.trim()!==row.manifest_sha256.trim()||hash(q.manifest)!==hash(m)||q.decision!=='approve'||q.reviewer_id===row.user_id||q.reviewer_id!==acceptance.reviewerId||!acceptance.authority||!syncEqual(q.target,acceptance.authority)||q.recorded_at>q.reviewed_at||q.reviewed_at>row.original_received_at)fail();
    recovery={id:q.id,userId:q.user_id,captureId:q.capture_id,manifestSha256:q.manifest_sha256.trim(),target:q.target,recordedAt:stamp(q.recorded_at),review:{id:q.review_id,decision:'approve',reviewerId:q.reviewer_id,recordedAt:stamp(q.reviewed_at)}};
   }else if(acceptance.reviewerId!==null||hash(acceptance.authority)!==hash(m.sync??null))fail();
  }else if(m.sync)fail();
  if(!recovery&&(row.accepted_authority_id!==m.authorityId||row.accepted_authority_version!==m.authorityVersion))fail();
  const payload:FieldProvenance['payload']={format:'inveos.field_provenance.v1',caseId,evidenceId,userId:row.user_id,manifest:m,manifestSha256:row.manifest_sha256.trim(),receivedAt,originalReceivedAt:stamp(row.original_received_at),acceptedAuthority:{id:row.accepted_authority_id,version:row.accepted_authority_version},captureGrant,acceptance,acceptanceGrant,recovery,interpretation:'historical_capture_and_acceptance_not_device_attestation'};values.push({payload,sha256:hash(payload)});
 }
 return values;
}
