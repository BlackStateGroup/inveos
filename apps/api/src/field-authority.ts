import {randomUUID} from 'node:crypto';
import type {PoolClient,QueryResultRow} from 'pg';
import type {FieldAcceptance,FieldDevice,FieldGrant,FieldManifest,FieldSyncAuthority} from '@inveos/contracts';
import type {Actor} from './app.js';
import {collectionOpen,type LifecycleCase} from './case-lifecycle.js';
import {ApiError,notFound} from './errors.js';
export type FieldCase=LifecycleCase&{access_version:number;owner_user_id:string};
const stamp=(v:Date|string)=>new Date(v).toISOString();
export const syncOrder=(s:FieldSyncAuthority)=>({deviceId:s.deviceId,deviceVersion:s.deviceVersion,grantId:s.grantId,grantVersion:s.grantVersion,authorityId:s.authorityId,authorityVersion:s.authorityVersion,caseAccessVersion:s.caseAccessVersion});
export const syncEqual=(a:FieldSyncAuthority,b:FieldSyncAuthority)=>JSON.stringify(syncOrder(a))===JSON.stringify(syncOrder(b));
export function deviceDto(r:QueryResultRow):FieldDevice{return {id:r.id,label:r.label,userId:r.user_id,userName:r.user_name,version:r.version??1,state:r.state??(r.revoked_at?'revoked':'active'),createdAt:stamp(r.created_at),revokedAt:r.revoked_at?stamp(r.revoked_at):r.state&&r.state!=='active'?stamp(r.event_at):null,revocationReason:r.state==='active'?null:r.reason??null};}
export async function deviceRow(c:PoolClient,tenantId:string,userId:string,deviceId:string,lock=false){
 const row=(await c.query(`SELECT * FROM field_devices WHERE tenant_id=$1 AND user_id=$2 AND id=$3 ${lock?'FOR UPDATE':''}`,[tenantId,userId,deviceId])).rows[0];if(!row)notFound();
 const e=(await c.query('SELECT * FROM field_device_events WHERE tenant_id=$1 AND user_id=$2 AND device_id=$3 ORDER BY version DESC LIMIT 1',[tenantId,userId,deviceId])).rows[0];if(!e)throw new ApiError(409,'Device control history unavailable.');return {...row,version:e.version,state:e.state,event_at:e.recorded_at,reason:e.state==='active'?null:e.reason};
}
export async function activeDevice(c:PoolClient,a:Actor,id:string,expectedVersion?:number){const row=await deviceRow(c,a.tenantId,a.userId,id,true);if(row.state!=='active'||(expectedVersion!==undefined&&row.version!==expectedVersion))throw new ApiError(409,'Device is lost, revoked or changed. Preserve local originals and request independent recovery.');return row;}
export async function deviceEvent(c:PoolClient,a:Actor,userId:string,deviceId:string,id:string,version:number,state:'active'|'lost'|'revoked',reason:string){await c.query('INSERT INTO field_device_events(tenant_id,user_id,device_id,id,version,state,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.tenantId,userId,deviceId,id,version,state,a.userId,reason]);}
export async function latestGrant(c:PoolClient,tenantId:string,caseId:string,userId:string,deviceId:string){return (await c.query('SELECT *,expires_at>clock_timestamp() live FROM field_case_grants WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3 AND device_id=$4 ORDER BY version DESC LIMIT 1',[tenantId,caseId,userId,deviceId])).rows[0];}
export function grantCurrent(r:QueryResultRow|undefined,kase:FieldCase,device:QueryResultRow){return !!r&&r.state==='granted'&&r.live&&device.state==='active'&&r.device_version===device.version&&r.authority_version===kase.authority_version&&r.access_version===kase.access_version&&collectionOpen(kase);}
export function grantDto(r:QueryResultRow,current:boolean):FieldGrant{return {id:r.id,caseId:r.case_id,userId:r.user_id,deviceId:r.device_id,version:r.version,state:r.state,deviceVersion:r.device_version,authorityId:r.authority_id,authorityVersion:r.authority_version,caseAccessVersion:r.access_version,actorId:r.actor_id,reason:r.reason,recordedAt:stamp(r.recorded_at),expiresAt:stamp(r.expires_at),current};}
export const grantAuthority=(r:QueryResultRow):FieldSyncAuthority=>({deviceId:r.device_id,deviceVersion:r.device_version,grantId:r.id,grantVersion:r.version,authorityId:r.authority_id,authorityVersion:r.authority_version,caseAccessVersion:r.access_version});
export async function appendGrant(c:PoolClient,a:Actor,caseId:string,kase:FieldCase,userId:string,device:QueryResultRow,old:QueryResultRow|undefined,state:'granted'|'withdrawn',reason:string,id:string=randomUUID()){
 if(state==='granted'&&!collectionOpen(kase))throw new ApiError(409,'Current authority and an open collection stage are required.');
 if(old?.version>=1000)throw new ApiError(409,'Device grant history limit reached.');
 if(state==='granted'&&!(await c.query("SELECT 1 FROM case_memberships cm JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id WHERE cm.tenant_id=$1 AND cm.case_id=$2 AND cm.user_id=$3 AND m.role IN ('investigator','reviewer')",[a.tenantId,caseId,userId])).rowCount)throw new ApiError(409,'Device owner needs current internal case membership.');
 if(state==='withdrawn'&&!old)throw new ApiError(409,'No existing grant to withdraw.');
 const authority=(await c.query('SELECT id FROM authority_records WHERE tenant_id=$1 AND case_id=$2 AND version=$3',[a.tenantId,caseId,state==='withdrawn'?old!.authority_version:kase.authority_version])).rows[0];if(!authority)throw new ApiError(409,'Authority unavailable.');
 return (await c.query(`INSERT INTO field_case_grants(tenant_id,case_id,user_id,device_id,id,version,state,device_version,authority_id,authority_version,access_version,actor_id,reason,recorded_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,statement_timestamp(),statement_timestamp()+interval '7 days') RETURNING *,true live`,[a.tenantId,caseId,userId,device.id,id,(old?.version??0)+1,state,device.version,authority.id,state==='withdrawn'?old!.authority_version:kase.authority_version,state==='withdrawn'?old!.access_version:kase.access_version,a.userId,reason])).rows[0];
}
// Caller holds the case row, then locks the device. All grant/control decisions use these same locks.
export async function checkGrant(c:PoolClient,a:Actor,caseId:string,kase:FieldCase,sync:FieldSyncAuthority){
 if(!(await c.query("SELECT 1 FROM case_memberships cm JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id WHERE cm.tenant_id=$1 AND cm.case_id=$2 AND cm.user_id=$3 AND m.role IN ('investigator','reviewer')",[a.tenantId,caseId,a.userId])).rowCount)notFound();
 const device=await activeDevice(c,a,sync.deviceId,sync.deviceVersion),grant=await latestGrant(c,a.tenantId,caseId,a.userId,sync.deviceId);
 if(!grantCurrent(grant,kase,device)||!syncEqual(grantAuthority(grant!),sync))throw new ApiError(409,'Case grant expired, was withdrawn, or authority/access changed. Preserve the capture for independent recovery.');
 return grant!;
}
export async function checkFieldAcceptance(c:PoolClient,a:Actor,caseId:string,kase:FieldCase,m:FieldManifest,manifestSha256:string,recoveryId?:string):Promise<Omit<FieldAcceptance,'receivedAt'>>{
 if(recoveryId){
  const row=(await c.query('SELECT q.*,r.decision,r.reviewer_id FROM field_recovery_requests q JOIN field_recovery_reviews r ON r.tenant_id=q.tenant_id AND r.case_id=q.case_id AND r.request_id=q.id WHERE q.tenant_id=$1 AND q.case_id=$2 AND q.id=$3 AND q.user_id=$4',[a.tenantId,caseId,recoveryId,a.userId])).rows[0];
  if(!row||row.decision!=='approve'||row.manifest_sha256.trim()!==manifestSha256||row.capture_id!==m.id||row.reviewer_id===a.userId)throw new ApiError(409,'An independent approval for this exact frozen capture is required.');
  if(!(await c.query("SELECT 1 FROM case_memberships cm JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id WHERE cm.tenant_id=$1 AND cm.case_id=$2 AND cm.user_id=$3 AND m.role='reviewer'",[a.tenantId,caseId,row.reviewer_id])).rowCount)throw new ApiError(409,'Recovery reviewer no longer has current case access.');
  await checkGrant(c,a,caseId,kase,row.target);return {authority:row.target,recoveryId,reviewerId:row.reviewer_id};
 }
 await activeDevice(c,a,m.deviceId,m.sync?.deviceVersion??1);
 if(m.authorityVersion!==kase.authority_version)throw new ApiError(409,'Offline authority changed. Preserve the capture for independent recovery.');
 if(m.sync){if(m.sync.deviceId!==m.deviceId||m.sync.authorityId!==m.authorityId||m.sync.authorityVersion!==m.authorityVersion)throw new ApiError(422,'Frozen capture and grant authority differ.');await checkGrant(c,a,caseId,kase,m.sync);}
 else {
  // Previously queued v1 manifests stay byte-identical. Once device/case grants exist, fresh unversioned acceptance is fenced.
  if(await latestGrant(c,a.tenantId,caseId,a.userId,m.deviceId))throw new ApiError(409,'Legacy capture needs independent recovery under the current versioned grant.');
 }
 return {authority:m.sync??null,recoveryId:null,reviewerId:null};
}
