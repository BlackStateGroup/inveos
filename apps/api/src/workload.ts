import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError} from './errors.js';
type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const owner={anyOf:[uuid,{const:'unassigned'}]};
const common={caseId:uuid,kind:{enum:['task','question','handover']}};
const scope=`FROM case_work_items w JOIN cases k ON k.tenant_id=w.tenant_id AND k.id=w.case_id
 JOIN case_memberships mine ON mine.tenant_id=w.tenant_id AND mine.case_id=w.case_id AND mine.user_id=$2
 JOIN memberships viewer ON viewer.tenant_id=mine.tenant_id AND viewer.user_id=mine.user_id AND viewer.role='reviewer'
 WHERE w.tenant_id=$1 AND ($3::uuid IS NULL OR w.case_id=$3) AND w.kind IN ('task','question','handover')
 AND ($4::text IS NULL OR w.kind=$4) AND w.status NOT IN ('Complete','Resolved','Acknowledged')`;
export function registerWorkload(app:FastifyInstance,s:Services){
 const reviewer=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role!=='reviewer')throw new ApiError(403,'Team workload requires a current reviewer.');};
 const tx=<T>(run:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL statement_timeout='3s'");return run(c);});
 app.get('/api/work/workload',{preHandler:reviewer,schema:{querystring:{type:'object',additionalProperties:false,properties:{...common,after:owner}}}},r=>tx(async c=>{
  const a=r.actor!,q=r.query as {caseId?:string;kind?:string;after?:string};if(q.caseId)await s.findCase(c,a,q.caseId);
  const rows=(await c.query(`WITH visible AS (SELECT w.*,COALESCE(w.owner_id::text,'unassigned') owner_key ${scope}), totals AS (
   SELECT owner_key,owner_id,count(*)::int active_count,count(DISTINCT case_id)::int case_count,
    count(*) FILTER(WHERE status='Blocked')::int blocked_count,
    count(*) FILTER(WHERE due_date<(clock_timestamp() AT TIME ZONE 'UTC')::date)::int overdue_count,
    count(*) FILTER(WHERE due_date BETWEEN (clock_timestamp() AT TIME ZONE 'UTC')::date AND (clock_timestamp() AT TIME ZONE 'UTC')::date+7)::int due_count,
    count(*) FILTER(WHERE due_date IS NULL)::int undated_count FROM visible GROUP BY owner_key,owner_id)
   SELECT t.*,CASE WHEN t.owner_id IS NULL THEN 'Unassigned' ELSE COALESCE(u.display_name,'Former case member') END name FROM totals t
   LEFT JOIN users u ON u.id=t.owner_id AND EXISTS(SELECT 1 FROM visible v JOIN case_memberships cm ON cm.tenant_id=v.tenant_id AND cm.case_id=v.case_id AND cm.user_id=v.owner_id JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id AND m.role IN ('reviewer','investigator') WHERE v.owner_id=t.owner_id)
   WHERE ($5::text IS NULL OR t.owner_key>$5) ORDER BY t.owner_key LIMIT 51`,[a.tenantId,a.userId,q.caseId??null,q.kind??null,q.after??null])).rows;
  return {items:rows.slice(0,50).map(row=>({ownerKey:row.owner_key,name:row.name,active:row.active_count,cases:row.case_count,blocked:row.blocked_count,overdue:row.overdue_count,dueWithinSevenDays:row.due_count,undated:row.undated_count})),next:rows.length>50?rows[49].owner_key:null,observedAt:new Date().toISOString(),interpretation:'current_visible_coordination_not_effort_or_findings'};
 }));
 app.get('/api/work/workload/items',{preHandler:reviewer,schema:{querystring:{type:'object',additionalProperties:false,required:['owner'],properties:{...common,owner,afterId:uuid,afterCaseId:uuid,afterDue:{type:'string',pattern:'^(none|[1-9][0-9]{3}-[0-9]{2}-[0-9]{2})$'}}}}},r=>tx(async c=>{
  const a=r.actor!,q=r.query as {caseId?:string;kind?:string;owner:string;afterId?:string;afterCaseId?:string;afterDue?:string};if(q.caseId)await s.findCase(c,a,q.caseId);
  const cursor=[q.afterId,q.afterCaseId,q.afterDue].filter(x=>x!==undefined);if(cursor.length!==0&&cursor.length!==3)throw new ApiError(422,'Supply the complete workload cursor.');
  if(q.afterDue&&q.afterDue!=='none'){const date=new Date(q.afterDue+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==q.afterDue)throw new ApiError(422,'Invalid workload cursor date.');}
  const rows=(await c.query(`SELECT w.id,w.case_id,w.kind,w.title,left(w.body,260) excerpt,w.status,w.version,w.due_date::text due_date,w.updated_at,k.ref case_ref,k.title case_title ${scope}
   AND COALESCE(w.owner_id::text,'unassigned')=$5
   AND ($6::uuid IS NULL OR (COALESCE(w.due_date,'infinity'::date),w.case_id,w.id)>(COALESCE($7::date,'infinity'::date),$8::uuid,$6::uuid))
   ORDER BY w.due_date NULLS LAST,w.case_id,w.id LIMIT 51`,[a.tenantId,a.userId,q.caseId??null,q.kind??null,q.owner,q.afterId??null,q.afterDue==='none'?null:q.afterDue??null,q.afterCaseId??null])).rows;
  return {items:rows.slice(0,50).map(row=>({id:row.id,caseId:row.case_id,kind:row.kind,title:row.title,excerpt:row.excerpt,status:row.status,version:row.version,dueDate:row.due_date,updatedAt:new Date(row.updated_at).toISOString(),caseRef:row.case_ref,caseTitle:row.case_title})),next:rows.length>50?{id:rows[49].id,caseId:rows[49].case_id,dueDate:rows[49].due_date}:null};
 }));
}
