import type {FieldSyncAuthority} from './field-sync.js';

/** First-party structured records, preserved as original UTF-8 JSON bytes in Field intake. */
export type FieldLocation={method:'manually_declared';description:string;latitude:number|null;longitude:number|null;uncertaintyMetres:number|null;purpose:string};
export type FieldAttachment={kind:'capture'|'evidence';id:string;sha256:string;relation:'source'|'media'|'context';note:string};
type RecordBase={format:'inveos.field.record.v1';id:string;tenantId:string;userId:string;caseId:string;sessionId:string;deviceId:string;authorityId:string;authorityVersion:number;sourceTime:string;deviceTime:string;clockUncertaintySeconds:number|null;reason:string};
export type FieldSessionRecord=RecordBase&{kind:'session_start'|'session_end'|'session_amend';expectedVersion:number;title:string;purpose:string;summary:string};
export type FieldObservationRecord=RecordBase&{kind:'observation_record'|'observation_correct';observationId:string;expectedVersion:number;supersedesCaptureId:string|null;status:'recorded'|'withdrawn';category:'observation'|'conversation'|'document'|'media'|'incident';title:string;account:string;basis:'directly_observed'|'reported_by_source'|'supplied_record';sourceDescription:string;consentBasis:string;location:FieldLocation|null;attachments:FieldAttachment[]};
export type FieldRecord=FieldSessionRecord|FieldObservationRecord;
export type FieldOrganiseRequest={id:string;captureId:string;expectedSha256:string;authority:FieldSyncAuthority;reason:string};
export type FieldRecordReceipt={id:string;caseId:string;userId:string;captureId:string;sessionId:string;observationId:string|null;version:number;previousCaptureId:string|null;record:FieldRecord;source:{evidenceId:string;sha256:string;manifestSha256:string;sourceTime:string;deviceTime:string;receivedAt:string};organisation:{authority:FieldSyncAuthority;reason:string;recordedAt:string};receivedAfterEnd:boolean;attachments:Array<FieldAttachment&{evidenceId:string;sourceTime:string;receivedTime:string}>};
export type FieldObservationReview={id:string;captureId:string;observationId:string;version:number;reviewerId:string;decision:'context_checked'|'needs_correction';reason:string;recordedAt:string;authorityVersion:number;caseAccessVersion:number};
export type FieldSessionView={id:string;userId:string;start:FieldRecordReceipt;latest:FieldRecordReceipt;end:FieldRecordReceipt|null};
export type FieldSessionDetail={session:FieldSessionView;events:FieldRecordReceipt[];observations:Array<{latest:FieldRecordReceipt;history:FieldRecordReceipt[];reviews:FieldObservationReview[]}>};
export const fieldUuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export function parseFieldRecord(value:unknown):FieldRecord{
 const bad=(detail:string):never=>{throw new Error('Invalid structured Field original: '+detail);};
 const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))bad('object required');return v as Record<string,unknown>;};
 const keys=(v:Record<string,unknown>,required:string[])=>{if(Object.keys(v).length!==required.length||required.some(k=>!Object.hasOwn(v,k)))bad('unexpected or missing fields');};
 const text=(v:unknown,min:number,max:number)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(v))bad('bounded plain text required');};
 const integer=(v:unknown,min:number,max:number)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)bad('explicit bounded integer required');};
 const one=(v:unknown,choices:unknown[])=>{if(!choices.includes(v))bad('unsupported value');};
 const r=obj(value),base=['format','id','tenantId','userId','caseId','sessionId','deviceId','authorityId','authorityVersion','sourceTime','deviceTime','clockUncertaintySeconds','reason','kind','expectedVersion','title'];
 one(r.format,['inveos.field.record.v1']);for(const k of ['id','tenantId','userId','caseId','sessionId','deviceId','authorityId'])if(!fieldUuid(r[k]))bad('UUID required');
 integer(r.authorityVersion,1,2147483647);integer(r.expectedVersion,0,999);if(r.clockUncertaintySeconds!==null)integer(r.clockUncertaintySeconds,0,86400);
 for(const k of ['sourceTime','deviceTime']){const time=r[k];if(typeof time!=='string'||time.length>64)bad('timezone-qualified time required');const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(time as string);if(!m||!Number.isFinite(Date.parse(time as string)))bad('timezone-qualified time required');const y=Number(m![1]),month=Number(m![2]),day=Number(m![3]),days=month===2?(y%4===0&&(y%100!==0||y%400===0)?29:28):[4,6,9,11].includes(month)?30:31;if(month<1||month>12||day<1||day>days||Number(m![4])>23||Number(m![5])>59||Number(m![6])>59||Number(m![7]??0)>23||Number(m![8]??0)>59)bad('calendar time is invalid');}
 text(r.reason,10,2000);text(r.title,3,200);
 if(['session_start','session_end','session_amend'].includes(String(r.kind))){keys(r,[...base,'purpose','summary']);text(r.purpose,10,2000);text(r.summary,0,4000);if(r.kind==='session_start'&&(r.expectedVersion!==0||r.id!==r.sessionId))bad('start identity/version differs');if(r.kind!=='session_start'&&r.expectedVersion===0)bad('existing session version required');}
 else{
  keys(r,[...base,'observationId','supersedesCaptureId','status','category','account','basis','sourceDescription','consentBasis','location','attachments']);one(r.kind,['observation_record','observation_correct']);if(!fieldUuid(r.observationId))bad('observation identity required');
  if(r.kind==='observation_record'&&(r.expectedVersion!==0||r.observationId!==r.id||r.supersedesCaptureId!==null||r.status!=='recorded'))bad('first observation identity/version differs');
  if(r.kind==='observation_correct'&&(r.expectedVersion===0||!fieldUuid(r.supersedesCaptureId)||r.id===r.supersedesCaptureId))bad('correction predecessor required');
  one(r.status,['recorded','withdrawn']);one(r.category,['observation','conversation','document','media','incident']);one(r.basis,['directly_observed','reported_by_source','supplied_record']);text(r.account,10,12000);text(r.sourceDescription,3,2000);text(r.consentBasis,10,2000);
  if(r.location!==null){const l=obj(r.location);keys(l,['method','description','latitude','longitude','uncertaintyMetres','purpose']);one(l.method,['manually_declared']);text(l.description,3,500);text(l.purpose,10,1000);if((l.latitude===null)!==(l.longitude===null))bad('coordinate pair required');for(const [k,max] of [['latitude',90],['longitude',180],['uncertaintyMetres',1000000]] as const)if(l[k]!==null&&(typeof l[k]!=='number'||!Number.isFinite(l[k])||Math.abs(l[k])>max||(k==='uncertaintyMetres'&&l[k]<0)))bad('invalid manual location/uncertainty');}
  if(!Array.isArray(r.attachments)||r.attachments.length>10)bad('at most ten attachment links');const seen=new Set<string>();for(const input of r.attachments as unknown[]){const a=obj(input);keys(a,['kind','id','sha256','relation','note']);one(a.kind,['capture','evidence']);one(a.relation,['source','media','context']);if(!fieldUuid(a.id)||a.id===r.id||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))bad('attachment identity/digest required');text(a.note,3,500);const key=a.kind+':'+a.id;if(seen.has(key))bad('duplicate attachment');seen.add(key);}
 }
 return value as FieldRecord;
}
/** Stable semantic comparison; original bytes are always hashed separately. */
export function fieldRecordCanonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(fieldRecordCanonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+fieldRecordCanonical(v)).join(',')+'}';return JSON.stringify(value);}
