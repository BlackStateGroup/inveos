import type {FieldManifest} from './index.js';
export type FieldSyncAuthority={deviceId:string;deviceVersion:number;grantId:string;grantVersion:number;authorityId:string;authorityVersion:number;caseAccessVersion:number};
export type FieldDeviceState='active'|'lost'|'revoked';
export type FieldDeviceEvent={id:string;version:number;state:FieldDeviceState;actorId:string;reason:string;recordedAt:string};
export type FieldGrant={id:string;caseId:string;userId:string;deviceId:string;version:number;state:'granted'|'withdrawn';deviceVersion:number;authorityId:string;authorityVersion:number;caseAccessVersion:number;actorId:string;reason:string;recordedAt:string;expiresAt:string;current:boolean};
export type FieldAcceptance={authority:FieldSyncAuthority|null;recoveryId:string|null;reviewerId:string|null;receivedAt:string};
export type FieldRecovery={id:string;caseId:string;userId:string;captureId:string;manifest:FieldManifest;manifestSha256:string;target:FieldSyncAuthority;reason:string;recordedAt:string;review:{id:string;decision:'approve'|'reject';reviewerId:string;reason:string;recordedAt:string}|null};

export type FieldHistoricalGrant={authority:FieldSyncAuthority;userId:string;state:'granted';recordedAt:string;expiresAt:string};
export type FieldProvenance={sha256:string;payload:{format:'inveos.field_provenance.v1';caseId:string;evidenceId:string;userId:string;manifest:FieldManifest;manifestSha256:string;receivedAt:string;originalReceivedAt:string;acceptedAuthority:{id:string;version:number};captureGrant:FieldHistoricalGrant|null;acceptance:FieldAcceptance|null;acceptanceGrant:FieldHistoricalGrant|null;recovery:{id:string;userId:string;captureId:string;manifestSha256:string;target:FieldSyncAuthority;recordedAt:string;review:{id:string;decision:'approve';reviewerId:string;recordedAt:string}}|null;interpretation:'historical_capture_and_acceptance_not_device_attestation'}};
