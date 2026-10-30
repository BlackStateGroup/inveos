import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { workStatuses, type TaskStatusBatch, type TaskPlanBatch, type TaskStatusBatchResult, type WorkInput, type WorkEdit, type WorkItem, type WorkLink, type WorkLinkInput, type WorkRevision, type DocumentWorkLinkInput, type DocumentReportFinding, type TranscriptReportFinding } from '@inveos/contracts';
import type { Actor } from './app.js';
import { inTransaction } from './db.js';
import { ApiError, notFound } from './errors.js';

type Services = {
  pool: Pool;
  authenticate: (request: FastifyRequest) => Promise<void>;
  requireCsrf: (request: FastifyRequest) => Promise<void>;
  findCase: (client: PoolClient, actor: Actor, id: string, lock?: boolean) => Promise<unknown>;
  verifyDocumentFinding: (client: PoolClient, actor: Actor, caseId: string, findingId: string) => Promise<DocumentReportFinding>;
  verifyTranscriptFinding: (client: PoolClient, actor: Actor, caseId: string, findingId: string) => Promise<TranscriptReportFinding>;
  verifyClaim: (client: PoolClient, actor: Actor, caseId: string, claimId: string) => Promise<void>;
  audit: (client: PoolClient, actor: Actor, caseId: string, action: string, entityType: string, id: string, summary: string, metadata?: Record<string, unknown>) => Promise<void>;
};
const uuid = {type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'} as const;
const nullableUuid = {anyOf: [uuid, {type: 'null'}]} as const;
const editable = {
  title: {type: 'string', minLength: 3, maxLength: 200},
  body: {type: 'string', maxLength: 12000},
  ownerId: nullableUuid,
  dueDate: {anyOf: [{type: 'null'}, {type: 'string', pattern: '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$'}]},
} as const;
const params = {type: 'object', required: ['caseId', 'itemId'], additionalProperties: false, properties: {caseId: uuid, itemId: uuid}} as const;
const caseParams = {type: 'object', required: ['caseId'], additionalProperties: false, properties: {caseId: uuid}} as const;
const kinds = Object.keys(workStatuses);
const allStatuses = [...new Set(Object.values(workStatuses).flat())];
const iso = (date: Date | string) => new Date(date).toISOString();

export function displayWork(row: QueryResultRow): WorkItem {
  return {
    id: row.id, caseId: row.case_id, kind: row.kind, title: row.title, body: row.body,
    status: row.status, ownerId: row.owner_id, dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    parentId: row.parent_id, version: row.version, createdBy: row.created_by,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
export function displayWorkLink(row: QueryResultRow): WorkLink {
  const source = row.document_finding_id ? {kind:'document_finding' as const,findingId:row.document_finding_id}
    : row.transcript_finding_id ? {kind:'transcript_finding' as const,findingId:row.transcript_finding_id} : {claimId:row.claim_id};
  return {id:row.id,caseId:row.case_id,itemId:row.item_id,...source,relation:row.relation,reason:row.reason,createdBy:row.created_by,createdAt:iso(row.created_at),
    ...('kind' in source&&row.withdrawn_at?{withdrawal:{reason:row.withdrawal_reason,createdBy:row.withdrawn_by,createdAt:iso(row.withdrawn_at)}}:{})};
}

function validateText(input: Pick<WorkInput, 'title' | 'body' | 'dueDate'>, reason?: string): void {
  if (input.title.trim().length < 3 || (reason !== undefined && !reason.trim())) {
    throw new ApiError(422, 'Enter a title and a reason for this change.');
  }
  for (const value of [input.title, input.body, reason ?? '']) {
    if (Buffer.from(value, 'utf8').toString('utf8') !== value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      throw new ApiError(422, 'Text contains unsupported control characters.');
    }
  }
  if (input.dueDate) {
    const date = new Date(`${input.dueDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.dueDate) {
      throw new ApiError(422, 'Choose a valid calendar date.');
    }
  }
}

async function checkOwner(client: PoolClient, actor: Actor, caseId: string, ownerId: string | null): Promise<void> {
  if (!ownerId) return;
  const owner = await client.query(
    `SELECT 1 FROM case_memberships cm JOIN memberships m ON m.tenant_id = cm.tenant_id AND m.user_id = cm.user_id
      WHERE cm.tenant_id = $1 AND cm.case_id = $2 AND cm.user_id = $3 AND m.role IN ('reviewer', 'investigator')`,
    [actor.tenantId, caseId, ownerId],
  );
  if (!owner.rowCount) throw new ApiError(422, 'The owner must be an investigator or reviewer assigned to this case.');
}

async function findWork(client: PoolClient, actor: Actor, caseId: string, id: string): Promise<QueryResultRow> {
  const result = await client.query(
    'SELECT *, due_date::text AS due_date FROM case_work_items WHERE tenant_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE',
    [actor.tenantId, caseId, id],
  );
  if (!result.rows[0]) notFound();
  return result.rows[0];
}

async function workSources(client:PoolClient,actor:Actor,caseId:string,itemId:string,children=false):Promise<QueryResultRow[]> {
  const rows=(await client.query(`SELECT l.* FROM case_work_links l WHERE NOT EXISTS (SELECT 1 FROM case_work_link_withdrawals x WHERE x.tenant_id=l.tenant_id AND x.case_id=l.case_id AND x.link_id=l.id) AND l.tenant_id=$1 AND l.case_id=$2 AND
    (l.item_id=$3 OR ($4 AND l.item_id IN (SELECT id FROM case_work_items WHERE tenant_id=$1 AND case_id=$2 AND parent_id=$3 AND kind='hypothesis')))
    ORDER BY l.created_at,l.id LIMIT 1001`,[actor.tenantId,caseId,itemId,children])).rows;
  if(rows.length>1000)throw new ApiError(422,'Working source limit exceeded.');
  return rows;
}

async function recordRevision(client: PoolClient, actor: Actor, item: WorkItem, reason: string): Promise<void> {
  // Freeze the links visible to this decision. Later links never rewrite earlier assessments.
  const sources = await workSources(client, actor, item.caseId, item.id, item.kind === 'question');
  await client.query(
    `INSERT INTO case_work_revisions (tenant_id, case_id, item_id, version, snapshot, actor_id, actor_name, reason, source_links)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)`,
    [actor.tenantId, item.caseId, item.id, item.version, JSON.stringify(item), actor.userId, actor.displayName, reason, JSON.stringify(sources.map(displayWorkLink))],
  );
}

export function registerCaseWork(app: FastifyInstance, services: Services): void {
  const internal = async (request: FastifyRequest) => {
    await services.authenticate(request);
    if (request.actor!.role === 'client') throw new ApiError(403, 'This role cannot access internal case work.');
  };
  app.post('/api/cases/:caseId/work', {
    preHandler: services.requireCsrf,
    schema: {params: caseParams, body: {type: 'object', additionalProperties: false,
      required: ['id', 'kind', 'title', 'body', 'ownerId', 'dueDate', 'parentId'],
      properties: {...editable, id: uuid, kind: {type: 'string', enum: kinds}, parentId: nullableUuid}}},
  }, async (request) => {
    const actor = request.actor!;
    const {caseId} = request.params as {caseId: string};
    const input = request.body as WorkInput;
    validateText(input);
    const requestHash = createHash('sha256').update(JSON.stringify([
      input.id, input.kind, input.title, input.body, input.ownerId, input.dueDate, input.parentId,
    ])).digest('hex');
    return inTransaction(services.pool, async (client) => {
      await services.findCase(client, actor, caseId, true);
      const replay = await client.query('SELECT *, due_date::text AS due_date FROM case_work_items WHERE tenant_id = $1 AND case_id = $2 AND id = $3', [actor.tenantId, caseId, input.id]);
      if (replay.rows[0]) {
        if (replay.rows[0].created_by !== actor.userId || replay.rows[0].request_hash !== requestHash) {
          throw new ApiError(409, 'This record identifier has already been used. Refresh before trying again.');
        }
        return displayWork(replay.rows[0]);
      }
      await checkOwner(client, actor, caseId, input.ownerId);
      if (input.parentId) {
        const parent = await findWork(client, actor, caseId, input.parentId);
        if (!['question', 'objective'].includes(parent.kind)) throw new ApiError(422, 'Link work to a question or objective in this case.');
        if (input.kind === 'hypothesis' && parent.kind !== 'question') throw new ApiError(422, 'A hypothesis must belong to an investigation question.');
      } else if (input.kind === 'hypothesis') {
        throw new ApiError(422, 'A hypothesis must belong to an investigation question.');
      }
      const inserted = await client.query(
        `INSERT INTO case_work_items (tenant_id, case_id, id, kind, title, body, status, owner_id, due_date, parent_id, request_hash, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *, due_date::text AS due_date`,
        [actor.tenantId, caseId, input.id, input.kind, input.title, input.body, workStatuses[input.kind][0], input.ownerId, input.dueDate, input.parentId, requestHash, actor.userId],
      );
      const item = displayWork(inserted.rows[0]);
      await recordRevision(client, actor, item, 'Record created');
      await services.audit(client, actor, caseId, 'work.created', 'case_work', item.id, `${input.kind}: ${input.title}`, {kind: input.kind, version: 1});
      return item;
    });
  });

  app.post('/api/cases/:caseId/work/:itemId/revise', {
    preHandler: services.requireCsrf,
    schema: {params, body: {type: 'object', additionalProperties: false,
      required: ['expectedVersion', 'title', 'body', 'ownerId', 'dueDate', 'status', 'reason'],
      properties: {...editable, expectedVersion: {type: 'integer', minimum: 1}, status: {type: 'string', enum: allStatuses}, reason: {type: 'string', minLength: 1, maxLength: 3000}}}},
  }, async (request) => {
    const actor = request.actor!;
    const {caseId, itemId} = request.params as {caseId: string; itemId: string};
    const input = request.body as WorkEdit;
    validateText(input, input.reason);
    return inTransaction(services.pool, async (client) => {
      await services.findCase(client, actor, caseId, true);
      const current = displayWork(await findWork(client, actor, caseId, itemId));
      if (current.version !== input.expectedVersion) throw new ApiError(409, 'Someone changed this record. Refresh and compare the latest version before saving.');
      if (!(workStatuses[current.kind] as readonly string[]).includes(input.status)) throw new ApiError(422, 'This status is not valid for this kind of work.');
      if (current.kind === 'handover' && input.status === 'Acknowledged' && current.ownerId !== actor.userId) {
        throw new ApiError(403, 'Only the assigned recipient can acknowledge this handover.');
      }
      if (current.kind === 'handover' && input.status === 'Acknowledged' && input.ownerId !== current.ownerId) {
        throw new ApiError(422, 'Reassign this handover separately before the new recipient acknowledges it.');
      }
      if ((current.kind === 'hypothesis' && ['Supported', 'Disputed'].includes(input.status)) || (current.kind === 'question' && input.status === 'Resolved')) {
        const sources = await workSources(client, actor, caseId, itemId, current.kind === 'question');
        if (current.kind === 'hypothesis' && !sources.some(s => s.relation === (input.status === 'Supported' ? 'supports' : 'contradicts'))) {
          throw new ApiError(422, 'Link supporting or contrary source material before recording this assessment.');
        }
        // Check contrary/context as well as supporting material; no cherry-picked stale sources.
        for (const source of sources) {
          if (source.document_finding_id) await services.verifyDocumentFinding(client, actor, caseId, source.document_finding_id);
          else if(source.transcript_finding_id) await services.verifyTranscriptFinding(client,actor,caseId,source.transcript_finding_id);
          else await services.verifyClaim(client, actor, caseId, source.claim_id);
        }
      }
      await checkOwner(client, actor, caseId, input.ownerId);
      const updated = await client.query(
        `UPDATE case_work_items SET title=$4, body=$5, status=$6, owner_id=$7, due_date=$8, version=version+1, updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND case_id=$2 AND id=$3 RETURNING *, due_date::text AS due_date`,
        [actor.tenantId, caseId, itemId, input.title, input.body, input.status, input.ownerId, input.dueDate],
      );
      const item = displayWork(updated.rows[0]);
      await recordRevision(client, actor, item, input.reason);
      await services.audit(client, actor, caseId, 'work.revised', 'case_work', itemId, `${item.kind} updated: ${item.title}`, {version: item.version, reason: input.reason});
      return item;
    });
  });

  for(const planning of [false,true])app.post('/api/cases/:caseId/work/'+(planning?'task-plan-batches':'task-status-batches'), {
    preHandler: services.requireCsrf,
    preValidation: async request => {
      const body=request.body as (TaskStatusBatch&TaskPlanBatch)|null;
      const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
      if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.id!=='string'||(!planning&&typeof body.status!=='string')||typeof body.reason!=='string'||
         (planning&&body.ownerChange!==undefined&&(!object(body.ownerChange)||(body.ownerChange.ownerId!==null&&typeof body.ownerChange.ownerId!=='string')))||
         (planning&&body.dueDateChange!==undefined&&(!object(body.dueDateChange)||(body.dueDateChange.dueDate!==null&&typeof body.dueDateChange.dueDate!=='string')))||
         !Array.isArray(body.items)||body.items.some(item=>!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||typeof item.expectedVersion!=='number'))
        throw new ApiError(422,'Choose explicit task identities, numeric versions, changes and a reason.');
    },
    schema:{params:caseParams,body:{type:'object',additionalProperties:false,required:['id','items','reason',...(planning?[]:['status'])],...(planning?{anyOf:[{required:['ownerChange']},{required:['dueDateChange']}]}:{}),properties:{
      id:uuid,...(planning?{ownerChange:{type:'object',additionalProperties:false,required:['ownerId'],properties:{ownerId:nullableUuid}},dueDateChange:{type:'object',additionalProperties:false,required:['dueDate'],properties:{dueDate:editable.dueDate}}}:{status:{type:'string',enum:workStatuses.task}}),reason:{type:'string',minLength:10,maxLength:3000},
      items:{type:'array',minItems:1,maxItems:50,items:{type:'object',additionalProperties:false,required:['id','expectedVersion'],properties:{id:uuid,expectedVersion:{type:'integer',minimum:1,maximum:2147483646}}}},
    }}},
  },async request=>{
    const actor=request.actor!,{caseId}=request.params as {caseId:string},input=request.body as TaskStatusBatch&TaskPlanBatch;
    const ownerChange=input.ownerChange?{ownerId:input.ownerChange.ownerId?.toLowerCase()??null}:undefined,dueDateChange=input.dueDateChange;
    const table=planning?'task_plan_batches':'task_status_batches';
    const reason=input.reason.trim(),id=input.id.toLowerCase(),items=input.items.map(item=>({id:item.id.toLowerCase(),expectedVersion:item.expectedVersion})).sort((a,b)=>a.id.localeCompare(b.id));
    validateText({title:'Task batch',body:'',dueDate:dueDateChange?.dueDate??null},reason);
    if(reason.length<10||new Set(items.map(item=>item.id)).size!==items.length)throw new ApiError(422,'Choose distinct tasks and give a clear reason.');
    const hash=createHash('sha256').update(JSON.stringify(planning?{items,ownerChange:ownerChange??null,dueDateChange:dueDateChange??null,reason}:{items,status:input.status,reason})).digest('hex');
    return inTransaction(services.pool,async client=>{
      await client.query("SET LOCAL lock_timeout='2s'");await client.query("SET LOCAL statement_timeout='5s'");
      await services.findCase(client,actor,caseId,true);
      const previous=(await client.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND case_id=$2 AND id=$3`,[actor.tenantId,caseId,id])).rows[0];
      if(previous&&(previous.actor_id!==actor.userId||previous.request_hash!==hash))throw new ApiError(409,'This batch identity was used for a different decision.');
      const current:WorkItem[]=[];
      // Resolve the complete selection inside this case before changing anything.
      for(const selected of items){const item=displayWork(await findWork(client,actor,caseId,selected.id));
        if(item.kind!=='task')throw new ApiError(422,'Batch changes apply only to tasks.');
        current.push(item);
      }
      if(previous)return {id,applied:previous.applied,items:current} satisfies TaskStatusBatchResult;
      if(current.some((item,i)=>item.version!==items[i]!.expectedVersion))throw new ApiError(409,'A selected task changed. Refresh and select its current version; no tasks were changed.');
      if(planning){
        if(ownerChange)await checkOwner(client,actor,caseId,ownerChange.ownerId);
        if(current.some(item=>(!ownerChange||item.ownerId===ownerChange.ownerId)&&(!dueDateChange||item.dueDate===dueDateChange.dueDate)))throw new ApiError(422,'Every selected task must change owner or deadline; no tasks were changed.');
      }else if(current.some(item=>item.status===input.status))throw new ApiError(422,'Every selected task must change status; no tasks were changed.');
      const count=(await client.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1 AND case_id=$2`,[actor.tenantId,caseId])).rows[0].n;
      if(count>=1000)throw new ApiError(409,'This case has reached its batch limit. Individual task revisions remain available.');
      const updated:WorkItem[]=[];
      for(const item of current){
        const row=(await client.query(`UPDATE case_work_items SET status=$4,owner_id=$5,due_date=$6,version=version+1,updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND case_id=$2 AND id=$3 RETURNING *,due_date::text AS due_date`,[actor.tenantId,caseId,item.id,planning?item.status:input.status,ownerChange?ownerChange.ownerId:item.ownerId,dueDateChange?dueDateChange.dueDate:item.dueDate])).rows[0];
        const next=displayWork(row);await recordRevision(client,actor,next,reason);
        await services.audit(client,actor,caseId,'work.revised','case_work',next.id,planning?'Task assignment/deadline changed in a recorded batch':'Task status changed in a recorded batch',{version:next.version,reason,batchId:id});updated.push(next);
      }
      const applied=updated.map(item=>({id:item.id,version:item.version}));
      await client.query(`INSERT INTO ${table}(tenant_id,case_id,id,request_hash,actor_id,applied) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[actor.tenantId,caseId,id,hash,actor.userId,JSON.stringify(applied)]);
      await services.audit(client,actor,caseId,planning?'work.task_plan_batch':'work.task_batch',planning?'task_plan_batch':'task_status_batch',id,planning?'Task assignment/deadline batch recorded':'Task status batch recorded',planning?{count:applied.length,ownerChange:ownerChange??null,dueDateChange:dueDateChange??null}:{count:applied.length,status:input.status});
      return {id,applied,items:updated} satisfies TaskStatusBatchResult;
    });
  });

  app.get('/api/cases/:caseId/work/:itemId/history', {preHandler: internal, schema: {params}}, async (request) => {
    const actor = request.actor!;
    const {caseId, itemId} = request.params as {caseId: string; itemId: string};
    return inTransaction(services.pool, async (client) => {
      await services.findCase(client, actor, caseId);
      await findWork(client, actor, caseId, itemId);
      const rows = await client.query('SELECT * FROM case_work_revisions WHERE tenant_id=$1 AND case_id=$2 AND item_id=$3 ORDER BY version DESC', [actor.tenantId, caseId, itemId]);
      return rows.rows.map((row) => ({...(row.source_links === null ? {} : {sources: row.source_links}), version: row.version, item: row.snapshot, actor: row.actor_name, reason: row.reason, at: iso(row.created_at)} satisfies WorkRevision));
    });
  });

  for(const family of ['document','transcript'] as const){
    const column=family==='document'?'document_finding_id':'transcript_finding_id';
    const verify=family==='document'?services.verifyDocumentFinding:services.verifyTranscriptFinding;
  app.get(`/api/cases/:caseId/work/${family}-findings`, {
    preHandler: internal, schema: {params: caseParams, querystring: {type:'object',additionalProperties:false,properties:{after:uuid}}},
  }, async request => {
    const actor=request.actor!, {caseId}=request.params as {caseId:string}, {after}=request.query as {after?:string};
    return inTransaction(services.pool,async client=>{
      await services.findCase(client,actor,caseId);
      const rows=(await client.query(family==='document'?'SELECT id,text FROM document_findings WHERE tenant_id=$1 AND case_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 51':`SELECT f.id,p.snapshot->>'text' text FROM transcript_findings f JOIN transcript_claims p ON p.tenant_id=f.tenant_id AND p.case_id=f.case_id AND p.id=f.claim_id WHERE f.tenant_id=$1 AND f.case_id=$2 AND ($3::uuid IS NULL OR f.id>$3) ORDER BY f.id LIMIT 51`,[actor.tenantId,caseId,after??null])).rows;
      return {items:rows.slice(0,50),nextAfter:rows.length>50?rows[49].id:null, status:'historical_candidates_reverification_required'};
    });
  });
  app.get(`/api/cases/:caseId/work/${family}-findings/:findingId`, {
    preHandler:internal,schema:{params:{type:'object',additionalProperties:false,required:['caseId','findingId'],properties:{caseId:uuid,findingId:uuid}}},
  }, async (request,reply)=>{
    reply.header('Cache-Control','no-store');
    const actor=request.actor!,{caseId,findingId}=request.params as {caseId:string;findingId:string};
    return inTransaction(services.pool,async client=>{
      await services.findCase(client,actor,caseId,true);
      const finding=await verify(client,actor,caseId,findingId);
      await services.audit(client,actor,caseId,`work.${family}_source_read`,`${family}_finding`,findingId,`Reverified ${family} source for investigation reasoning`);
      return finding;
    });
  });
  app.post(`/api/cases/:caseId/work/:itemId/${family}-links/:linkId/withdraw`, {
    preHandler:[services.requireCsrf,internal],schema:{params:{...params,required:['caseId','itemId','linkId'],properties:{...params.properties,linkId:uuid}},
      body:{type:'object',additionalProperties:false,required:['reason'],properties:{reason:{type:'string',minLength:1,maxLength:3000}}}},
  }, async request=>{
    const actor=request.actor!,{caseId,itemId,linkId}=request.params as {caseId:string;itemId:string;linkId:string}, {reason}=request.body as {reason:string};
    validateText({title:'Withdrawal',body:'',dueDate:null},reason);
    return inTransaction(services.pool,async client=>{
      await services.findCase(client,actor,caseId,true);await findWork(client,actor,caseId,itemId);
      const link=(await client.query(`SELECT * FROM case_work_links WHERE tenant_id=$1 AND case_id=$2 AND item_id=$3 AND id=$4 AND ${column} IS NOT NULL`,[actor.tenantId,caseId,itemId,linkId])).rows[0];if(!link)notFound();
      const old=(await client.query('SELECT * FROM case_work_link_withdrawals WHERE tenant_id=$1 AND case_id=$2 AND link_id=$3',[actor.tenantId,caseId,linkId])).rows[0];
      if(old){if(old.reason!==reason||old.created_by!==actor.userId)throw new ApiError(409,'A different withdrawal is already recorded.');return {reason:old.reason,createdBy:old.created_by,createdAt:iso(old.created_at)};}
      const saved=(await client.query('INSERT INTO case_work_link_withdrawals(tenant_id,case_id,link_id,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[actor.tenantId,caseId,linkId,reason,actor.userId])).rows[0];
      await services.audit(client,actor,caseId,`work.${family}_source_withdrawn`,'case_work',itemId,'Historical link retained; source withdrawn from current reasoning',{linkId,reason});
      return {reason,createdBy:actor.userId,createdAt:iso(saved.created_at)};
    });
  });
  app.post(`/api/cases/:caseId/work/:itemId/${family}-links`, {
    preHandler:[services.requireCsrf,internal],
    schema:{params,body:{type:'object',additionalProperties:false,required:['id','findingId','relation','reason'],properties:{id:uuid,findingId:uuid,relation:{enum:['supports','contradicts','context']},reason:{type:'string',minLength:1,maxLength:3000}}}},
  }, async request=>{
    const actor=request.actor!,{caseId,itemId}=request.params as {caseId:string;itemId:string},input=request.body as DocumentWorkLinkInput;
    validateText({title:'Reviewed source',body:'',dueDate:null},input.reason);
    return inTransaction(services.pool,async client=>{
      await services.findCase(client,actor,caseId,true);await findWork(client,actor,caseId,itemId);
      await verify(client,actor,caseId,input.findingId);
      const old=(await client.query(`SELECT l.*,w.reason AS withdrawal_reason,w.created_by AS withdrawn_by,w.created_at AS withdrawn_at
        FROM case_work_links l LEFT JOIN case_work_link_withdrawals w ON w.tenant_id=l.tenant_id AND w.case_id=l.case_id AND w.link_id=l.id
        WHERE l.tenant_id=$1 AND l.case_id=$2 AND (l.id=$3 OR (l.item_id=$4 AND l.${column}=$5 AND l.relation=$6))`,[actor.tenantId,caseId,input.id,itemId,input.findingId,input.relation])).rows[0];
      if(old){
        if(old.item_id!==itemId||old[column]!==input.findingId||old.relation!==input.relation||old.reason!==input.reason||old.created_by!==actor.userId)throw new ApiError(409,'A different source link already exists.');
        return displayWorkLink(old);
      }
      const row=(await client.query(`INSERT INTO case_work_links(tenant_id,case_id,id,item_id,${column},relation,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[actor.tenantId,caseId,input.id,itemId,input.findingId,input.relation,input.reason,actor.userId])).rows[0];
      await services.audit(client,actor,caseId,`work.${family}_source_linked`,'case_work',itemId,`Reviewed ${family} finding linked to working investigation context`,{findingId:input.findingId,relation:input.relation});
      return displayWorkLink(row);
    });
  });


  }

  app.get('/api/work/queue', {preHandler: internal, schema:{querystring:{type:'object',additionalProperties:false,properties:{
    kind:{enum:kinds},status:{enum:allStatuses},afterId:uuid,afterDue:{type:'string',pattern:'^(none|[1-9][0-9]{3}-[0-9]{2}-[0-9]{2})$'},
  }}}}, async (request) => {
    const actor=request.actor!,input=request.query as {kind?:string;status?:string;afterId?:string;afterDue?:string};
    if(Boolean(input.afterId)!==(input.afterDue!==undefined))throw new ApiError(422,'Supply the complete queue cursor.');
    if(input.afterDue&&input.afterDue!=='none')validateText({title:'Queue cursor',body:'',dueDate:input.afterDue});
    return inTransaction(services.pool, async (client) => {
      await client.query("SET LOCAL statement_timeout='2s'");
      // Current membership and ownership apply to every page; assignment never grants access.
      const rows=await client.query(
        `SELECT w.id,w.case_id,w.kind,w.title,w.status,w.version,w.updated_at,
                w.due_date::text AS due_date,left(w.body,260) AS excerpt,c.ref AS case_ref,c.title AS case_title
           FROM case_work_items w
           JOIN case_memberships cm ON cm.tenant_id=w.tenant_id AND cm.case_id=w.case_id AND cm.user_id=$2
           JOIN cases c ON c.tenant_id=w.tenant_id AND c.id=w.case_id
          WHERE w.tenant_id=$1 AND w.owner_id=$2 AND ($3::text IS NULL OR w.kind=$3) AND ($4::text IS NULL OR w.status=$4)
            AND ($5::uuid IS NULL OR (coalesce(w.due_date,'infinity'::date),w.id)>(coalesce($6::date,'infinity'::date),$5::uuid))
          ORDER BY w.due_date ASC NULLS LAST,w.id ASC LIMIT 101`,
        [actor.tenantId,actor.userId,input.kind??null,input.status??null,input.afterId??null,input.afterDue==='none'?null:input.afterDue??null],
      );
      const more=rows.rows.length>100,items=rows.rows.slice(0,100).map(row=>({id:row.id,caseId:row.case_id,kind:row.kind,title:row.title,
        status:row.status,version:row.version,dueDate:row.due_date,updatedAt:iso(row.updated_at),excerpt:row.excerpt,caseRef:row.case_ref,caseTitle:row.case_title})),last=items.at(-1);
      return {items,more,next:more?{id:last!.id,dueDate:last!.dueDate}:null,interpretation:'assigned_work_not_a_finding'};
    });
  });

  app.post('/api/cases/:caseId/work/:itemId/links', {
    preHandler: services.requireCsrf,
    schema: {params, body: {type: 'object', additionalProperties: false, required: ['id', 'claimId', 'relation', 'reason'],
      properties: {id: uuid, claimId: uuid, relation: {type: 'string', enum: ['supports', 'contradicts', 'context']}, reason: {type: 'string', minLength: 1, maxLength: 3000}}}},
  }, async (request) => {
    const actor = request.actor!;
    const {caseId, itemId} = request.params as {caseId: string; itemId: string};
    const input = request.body as WorkLinkInput;
    validateText({title: 'Source link', body: '', dueDate: null}, input.reason);
    return inTransaction(services.pool, async (client) => {
      await services.findCase(client, actor, caseId, true);
      await findWork(client, actor, caseId, itemId);
      await services.verifyClaim(client, actor, caseId, input.claimId);
      const previous = await client.query(
        `SELECT * FROM case_work_links WHERE tenant_id=$1 AND case_id=$2 AND
          (id=$3 OR (item_id=$4 AND claim_id=$5 AND relation=$6))`,
        [actor.tenantId, caseId, input.id, itemId, input.claimId, input.relation],
      );
      if (previous.rows[0]) {
        const link = displayWorkLink(previous.rows[0]);
        if (!('claimId' in link) || link.itemId !== itemId || link.claimId !== input.claimId || link.relation !== input.relation || link.reason !== input.reason) throw new ApiError(409, 'A different source link already exists.');
        return link;
      }
      const result = await client.query(
        `INSERT INTO case_work_links (tenant_id, case_id, id, item_id, claim_id, relation, reason, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [actor.tenantId, caseId, input.id, itemId, input.claimId, input.relation, input.reason, actor.userId],
      );
      await services.audit(client, actor, caseId, 'work.source_linked', 'case_work', itemId, `Source linked as ${input.relation}`, {claimId: input.claimId, relation: input.relation});
      return displayWorkLink(result.rows[0]);
    });
  });
}
