import {createHash} from 'node:crypto';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {Pool, PoolClient} from 'pg';
import type {AllegedTime, ChronologyEdit, ChronologyEvent, ChronologyInput, ChronologySource} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError, notFound} from './errors.js';

type Services = {
 pool: Pool; authenticate: (r: FastifyRequest) => Promise<void>; requireCsrf: (r: FastifyRequest) => Promise<void>;
 findCase: (c: PoolClient, a: Actor, id: string, lock?: boolean) => Promise<unknown>;
 source: (c: PoolClient, a: Actor, id: string, source: ChronologySource) => Promise<unknown>;
 audit: (c: PoolClient, a: Actor, caseId: string, action: string, entityType: string, id: string, summary: string) => Promise<void>;
};
const uuid = {type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const text = (maxLength: number, minLength = 0) => ({type: 'string', minLength, maxLength});
const nullableTime = {anyOf: [text(40, 1), {type: 'null'}]};
const properties = {
 title: text(200, 3), account: text(4000, 1), status: {enum: ['alleged', 'disputed', 'withdrawn']},
 time: {type: 'object', additionalProperties: false, required: ['precision', 'start', 'end', 'timezone', 'note'], properties: {
  precision: {enum: ['instant', 'day', 'month', 'range', 'unknown']}, start: nullableTime, end: nullableTime, timezone: text(100), note: text(1000, 1),
 }},
 source: {type: 'object', additionalProperties: false, required: ['kind', 'findingId'], properties: {kind: {enum: ['text_finding', 'document_finding']}, findingId: uuid}},
};
const caseParams = {type: 'object', additionalProperties: false, required: ['caseId'], properties: {caseId: uuid}};
const eventParams = {...caseParams, required: ['caseId', 'eventId'], properties: {...caseParams.properties, eventId: uuid}};
const clean = (value: string) => value.trim().length > 0 && Buffer.from(value).toString('utf8') === value && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
function day(value: string): boolean {
 if (!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
 const parsed = new Date(value+'T00:00:00Z');
 return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}
function instant(value: string): boolean {
 if (!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$/.test(value)) return false;
 // -00:00 declares an unknown offset; accepting it as an instant invents a timezone.
 if (value.endsWith('-00:00') || /[+-]14:(?!00)/.test(value)) return false;
 return day(value.slice(0,10)) && Number.isFinite(Date.parse(value));
}
export function validateAllegedTime(time: AllegedTime): void {
 const {precision,start,end} = time;
 const valid = precision === 'unknown' ? start === null && end === null
  : precision === 'instant' ? typeof start === 'string' && instant(start) && end === null
  : precision === 'day' ? typeof start === 'string' && day(start) && end === null
  : precision === 'month' ? typeof start === 'string' && /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(start) && end === null
  : precision === 'range' ? typeof start === 'string' && typeof end === 'string' && instant(start) && instant(end) && Date.parse(start) <= Date.parse(end) : false;
 if (!valid || !clean(time.note) || (time.timezone !== '' && !clean(time.timezone))) throw new ApiError(422, 'Preserve the stated precision and valid dates. Instants and range endpoints require a known offset; explain uncertainty in the date note.');
}
function validate(input: ChronologyInput | ChronologyEdit) {
 validateAllegedTime(input.time);
 if (!clean(input.title) || input.title.trim().length < 3 || !clean(input.account) || ('reason' in input && !clean(input.reason))) throw new ApiError(422, 'Enter an account and a meaningful correction reason without control characters.');
}
export async function chronologyRows(client: PoolClient, actor: Actor, caseId: string): Promise<ChronologyEvent[]> {
 const rows = await client.query(`SELECT r.snapshot FROM chronology_events e JOIN chronology_revisions r
  ON r.tenant_id=e.tenant_id AND r.case_id=e.case_id AND r.event_id=e.id AND r.version=e.version
  WHERE e.tenant_id=$1 AND e.case_id=$2 ORDER BY e.created_at,e.id LIMIT 1001`, [actor.tenantId,caseId]);
 if (rows.rows.length > 1000) throw new ApiError(422, 'Chronology limit exceeded.');
 return rows.rows.map(r => r.snapshot as ChronologyEvent);
}
export function registerChronology(app: FastifyInstance, s: Services): void {
 const internal = async (r: FastifyRequest) => {await s.authenticate(r); if (r.actor!.role === 'client') throw new ApiError(403, 'Internal chronology only.');};
 const base = '/api/cases/:caseId/chronology';
 app.get(base+'/sources',{preHandler:internal,schema:{params:caseParams}},async r=>inTransaction(s.pool,async c=>{
  const actor=r.actor!,{caseId}=r.params as {caseId:string};await s.findCase(c,actor,caseId);
  const rows=(await c.query(`SELECT 'text_finding' AS kind,id AS "findingId",text FROM findings WHERE tenant_id=$1 AND case_id=$2
   UNION ALL SELECT 'document_finding',id,text FROM document_findings WHERE tenant_id=$1 AND case_id=$2 ORDER BY kind,"findingId" LIMIT 1001`,[actor.tenantId,caseId])).rows;
  if(rows.length>1000)throw new ApiError(422,'Chronology source limit exceeded.');return rows;
 }));
 app.get(base, {preHandler: internal, schema: {params: caseParams}}, async r => inTransaction(s.pool, async c => {
  const {caseId} = r.params as {caseId: string}; await s.findCase(c,r.actor!,caseId);
  return {interpretation:'recorded_account_not_finding', order:'recorded_order_not_event_sequence', items:await chronologyRows(c,r.actor!,caseId)};
 }));
 const save = async (r: FastifyRequest, edit: boolean) => inTransaction(s.pool, async c => {
  const actor=r.actor!, {caseId,eventId} = r.params as {caseId: string; eventId?: string};
  if (actor.role === 'client') throw new ApiError(403, 'Internal chronology only.');
  const input=r.body as ChronologyInput & ChronologyEdit; validate(input); await s.findCase(c,actor,caseId,true);
  const id=edit?eventId!:input.id;
  const current=(await c.query(`SELECT e.*,r.snapshot FROM chronology_events e JOIN chronology_revisions r
   ON r.tenant_id=e.tenant_id AND r.case_id=e.case_id AND r.event_id=e.id AND r.version=e.version
   WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.id=$3`,[actor.tenantId,caseId,id])).rows[0];
  const hash=createHash('sha256').update(JSON.stringify([input.title,input.account,input.status,input.time.precision,input.time.start,input.time.end,input.time.timezone,input.time.note,input.source.kind,input.source.findingId])).digest('hex');
  if (!edit && current) {
   if (current.request_hash !== hash || current.created_by !== actor.userId) throw new ApiError(409, 'This chronology identity has already been used.');
   return current.snapshot; // Retry returns the latest revision, including withdrawal.
  }
  if (edit && !current) notFound();
  if (edit && current.version !== input.expectedVersion) throw new ApiError(409, 'Chronology changed. Refresh and compare the saved revision.');
  if (edit && current.version >= 1000) throw new ApiError(422, 'Chronology revision limit exceeded.');
  // A withdrawal may retain an unavailable historical source, but cannot substitute a new one.
  if (!(edit && input.status === 'withdrawn' && input.source.kind === current.snapshot.source.kind && input.source.findingId === current.snapshot.source.findingId)) await s.source(c,actor,caseId,input.source);
  if (!edit) {
   const count=(await c.query('SELECT count(*)::int AS n FROM chronology_events WHERE tenant_id=$1 AND case_id=$2',[actor.tenantId,caseId])).rows[0].n;
   if (count >= 1000) throw new ApiError(422, 'Chronology limit exceeded.');
  }
  const at=(await c.query('SELECT clock_timestamp() AS at')).rows[0].at.toISOString();
  const event: ChronologyEvent={id,caseId,title:input.title,account:input.account,status:input.status,time:input.time,source:input.source,version:edit?current.version+1:1,createdBy:edit?current.created_by:actor.userId,createdAt:edit?current.snapshot.createdAt:at,recordedAt:at,interpretation:'recorded_account_not_finding'};
  if (edit) await c.query('UPDATE chronology_events SET version=$4 WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,id,event.version]);
  else await c.query('INSERT INTO chronology_events(tenant_id,case_id,id,request_hash,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)',[actor.tenantId,caseId,id,hash,actor.userId,at]);
  await c.query('INSERT INTO chronology_revisions(tenant_id,case_id,event_id,version,snapshot,actor_id,actor_name,reason,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)',[actor.tenantId,caseId,id,event.version,JSON.stringify(event),actor.userId,actor.displayName,edit?input.reason:'Account recorded',at]);
  await s.audit(c,actor,caseId,edit?'chronology.revised':'chronology.recorded','chronology',id,`Chronology version ${event.version}: ${input.title}`);
  return event;
 });
 app.post(base,{preHandler:s.requireCsrf,schema:{params:caseParams,body:{type:'object',additionalProperties:false,required:['id',...Object.keys(properties)],properties:{id:uuid,...properties}}}},r=>save(r,false));
 app.post(base+'/:eventId/revise',{preHandler:s.requireCsrf,schema:{params:eventParams,body:{type:'object',additionalProperties:false,required:['expectedVersion','reason',...Object.keys(properties)],properties:{...properties,expectedVersion:{type:'integer',minimum:1},reason:text(3000,1)}}}},r=>save(r,true));
 app.get(base+'/:eventId/history',{preHandler:internal,schema:{params:eventParams}},async r=>inTransaction(s.pool,async c=>{
  const actor=r.actor!,{caseId,eventId}=r.params as {caseId:string;eventId:string};await s.findCase(c,actor,caseId);
  const rows=(await c.query('SELECT snapshot,actor_name,reason,created_at FROM chronology_revisions WHERE tenant_id=$1 AND case_id=$2 AND event_id=$3 ORDER BY version DESC LIMIT 1001',[actor.tenantId,caseId,eventId])).rows;
  if (!rows.length) notFound();if(rows.length>1000)throw new ApiError(422,'Chronology history limit exceeded.');
  return rows.map(row=>({event:row.snapshot,actor:row.actor_name,reason:row.reason,at:row.created_at.toISOString()}));
 }));
 app.get(base+'/:eventId/source',{preHandler:internal,schema:{params:eventParams}},async r=>inTransaction(s.pool,async c=>{
  const actor=r.actor!,{caseId,eventId}=r.params as {caseId:string;eventId:string};await s.findCase(c,actor,caseId);
  const event=(await chronologyRows(c,actor,caseId)).find(e=>e.id===eventId);if(!event)notFound();return s.source(c,actor,caseId,event.source);
 }));
}
