import type {FieldManifest} from './index.js';
export type FieldSyncAuthority={deviceId:string;deviceVersion:number;grantId:string;grantVersion:number;authorityId:string;authorityVersion:number;caseAccessVersion:number};
export type FieldDeviceState='active'|'lost'|'revoked';
export type FieldDeviceEvent={id:string;version:number;state:FieldDeviceState;actorId:string;reason:string;recordedAt:string};
export type FieldGrant={id:string;caseId:string;userId:string;deviceId:string;version:number;state:'granted'|'withdrawn';deviceVersion:number;authorityId:string;authorityVersion:number;caseAccessVersion:number;actorId:string;reason:string;recordedAt:string;expiresAt:string;current:boolean};
export type FieldAcceptance={authority:FieldSyncAuthority|null;recoveryId:string|null;reviewerId:string|null;receivedAt:string};
export type FieldRecovery={id:string;caseId:string;userId:string;captureId:string;manifest:FieldManifest;manifestSha256:string;target:FieldSyncAuthority;reason:string;recordedAt:string;review:{id:string;decision:'approve'|'reject';reviewerId:string;reason:string;recordedAt:string}|null};
