import {TranscriptWorkSources} from './TranscriptWorkSources';
import {WorkDiscussion,WorkMentions} from './WorkDiscussion';
import {DocumentWorkSources} from './DocumentWorkSources';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CalendarDays, Check, History, Link2, Plus, Search, X } from 'lucide-react';
import { workStatuses, type TaskStatusBatch, type TaskPlanBatch, type TaskStatusBatchResult, type WorkEdit, type WorkInput, type WorkItem, type WorkKind, type WorkLinkInput, type DocumentWorkLinkInput, type WorkRevision } from '@inveos/contracts';
import { Badge, Empty, Notice, Panel } from './ui';
import type { ViewProps } from './CaseViews';

export type WorkActions = {
  enabled: boolean;
  batchStatus: (input:TaskStatusBatch)=>Promise<TaskStatusBatchResult>;
  batchPlan: (input:TaskPlanBatch)=>Promise<TaskStatusBatchResult>;
  discussion: <T>(path:string,body?:object)=>Promise<T>;
  create: (input: WorkInput) => Promise<void>;
  revise: (id: string, input: WorkEdit) => Promise<void>;
  link: (id: string, input: WorkLinkInput) => Promise<void>;
  documentLink: (id: string, input: DocumentWorkLinkInput) => Promise<void>;
  transcriptLink: (id:string,input:DocumentWorkLinkInput)=>Promise<void>;
  withdrawTranscriptLink: (itemId:string,linkId:string,reason:string)=>Promise<void>;
  withdrawDocumentLink: (itemId:string,linkId:string,reason:string)=>Promise<void>;
  history: (id: string) => Promise<WorkRevision[]>;
  refresh: () => Promise<unknown>;
};

const labels: Record<WorkKind, string> = {
  objective: 'objective', question: 'question', hypothesis: 'hypothesis', task: 'task', note: 'note', handover: 'handover',
};
const done = new Set(['Complete', 'Resolved', 'Acknowledged']);
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
const atLabel = (value: string) => new Date(value).toLocaleString('en-GB', {timeZone: 'UTC'}) + ' UTC';

function AssignmentFields({p, ownerId, dueDate}: {p: ViewProps; ownerId?: string | null; dueDate?: string | null}) {
  return <div className="work-form-grid">
    <label className="form-label">Owner<select name="ownerId" defaultValue={ownerId ?? ''}>
      <option value="">Unassigned</option>
      {p.data.members.filter(m => m.caseId === p.active.id).map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
    </select></label>
    <label className="form-label">Due date<input type="date" name="dueDate" defaultValue={dueDate ?? ''}/></label>
  </div>;
}

function WorkForm({p, kind, item, onClose}: {p: ViewProps; kind: WorkKind; item?: WorkItem; onClose: () => void}) {
  const requestId = useRef(crypto.randomUUID());
  const expectedVersion = useRef(item?.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const shared = {title: String(fields.get('title') ?? ''), body: String(fields.get('body') ?? ''),
      ownerId: String(fields.get('ownerId') ?? '') || null, dueDate: String(fields.get('dueDate') ?? '') || null};
    setBusy(true); setError('');
    try {
      if (item) await p.work.revise(item.id, {...shared, expectedVersion: expectedVersion.current!,
        status: String(fields.get('status')) as WorkEdit['status'], reason: String(fields.get('reason') ?? '')});
      else await p.work.create({...shared, id: requestId.current, kind, parentId: String(fields.get('parentId') ?? '') || null});
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="work-form" onSubmit={event => void submit(event)} aria-label={`${item ? 'Edit' : 'New'} ${labels[kind]}`}>
    <div className="work-form-heading"><strong>{item ? `Revise ${labels[kind]}` : `New ${labels[kind]}`}</strong>
      <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Cancel editing"><X size={16}/></button></div>
    {error && <div className="form-error" role="alert">{error} Your unsaved text remains below. To edit a newer version, copy your changes, cancel this form and reopen the record. <button type="button" className="text-button" onClick={() => void p.work.refresh().catch(e => setError(e.message))}>Refresh saved records</button></div>}
    <fieldset disabled={busy}>
      <label className="form-label">Title<input name="title" required minLength={3} maxLength={200} defaultValue={item?.title} placeholder={kind === 'question' ? 'What do we need to establish?' : kind === 'hypothesis' ? 'A possible explanation to investigate' : 'Describe the work clearly'}/></label>
      <label className="form-label">{kind === 'handover' ? 'Context, outstanding work and next actions' : 'Details'}<textarea name="body" rows={3} maxLength={12000} defaultValue={item?.body}/></label>
      {!item && <label className="form-label">{kind === 'hypothesis' ? 'Investigation question' : 'Related question or objective'}<select name="parentId" required={kind === 'hypothesis'} defaultValue="">
        <option value="">{kind === 'hypothesis' ? 'Choose a question' : 'None'}</option>
        {p.data.workItems.filter(w => w.caseId === p.active.id && (kind === 'hypothesis' ? w.kind === 'question' : ['question', 'objective'].includes(w.kind))).map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
      </select></label>}
      <AssignmentFields p={p} ownerId={item?.ownerId} dueDate={item?.dueDate}/>
      {item && <><label className="form-label">Status<select name="status" defaultValue={item.status}>{workStatuses[kind].map(status => <option key={status}>{status}</option>)}</select></label>
        <label className="form-label">Reason for this revision<textarea name="reason" required maxLength={3000} rows={2} placeholder="Explain the correction, decision or handover acknowledgement."/></label>
        <p className="small muted">Saving creates version {expectedVersion.current! + 1}. Earlier versions and their source links remain in history.</p></>}
      <div className="work-form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" type="submit">{busy ? 'Saving…' : item ? 'Save revision' : `Add ${labels[kind]}`}<Check size={15}/></button></div>
    </fieldset>
  </form>;
}

function SourceLinks({p, item}: {p: ViewProps; item: WorkItem}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const links = p.data.workLinks.filter(l => l.itemId === item.id && l.caseId === item.caseId);
  const claims = p.data.claims.filter(c => c.caseId === item.caseId && c.evidenceId && c.quote.trim());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      await p.work.link(item.id, {id: requestId.current, claimId: String(fields.get('claimId')), relation: String(fields.get('relation')) as WorkLinkInput['relation'], reason: String(fields.get('reason'))});
      requestId.current = crypto.randomUUID(); setAdding(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="work-sources">
    <div className="work-subheading"><strong>Supporting & contrary material</strong><button className="text-button" onClick={() => setAdding(!adding)}><Link2 size={14}/>{adding ? 'Cancel link' : 'Link a source'}</button></div>
    {links.length === 0 && <p className="small muted">No material linked. A question or hypothesis is not a reviewed finding.</p>}
    {links.filter(link=>'claimId' in link).map(link => {
      const claim = p.data.claims.find(c => c.id === link.claimId && c.caseId === item.caseId);
      const source = p.data.evidence.find(e => e.id === claim?.evidenceId && e.caseId === item.caseId);
      return <div className="work-source" key={link.id}>
        <div><Badge tone={link.relation === 'contradicts' ? 'amber' : 'neutral'}>{link.relation === 'contradicts' ? 'Contrary material' : link.relation === 'supports' ? 'Supporting material' : 'Context'}</Badge><span className="small muted">Claim: {claim?.status ?? 'Unavailable'}</span>{source?.status !== 'Verified' && <Badge tone="red">Original does not currently verify</Badge>}</div>
        <blockquote>{claim?.quote ?? 'Supporting claim is unavailable.'}</blockquote><p>{link.reason}</p>
        {source && <button className="text-button" onClick={() => p.inspect(source.id)}>{source.filename}<ArrowUpRight size={14}/></button>}
      </div>;
    })}
    <DocumentWorkSources key={item.caseId+':'+item.id} caseId={item.caseId} itemId={item.id} links={links.filter(link=>'kind' in link&&link.kind==='document_finding')} save={p.work.documentLink} withdraw={p.work.withdrawDocumentLink} inspect={p.inspect}/>
    <TranscriptWorkSources key={'transcript:'+item.caseId+':'+item.id} caseId={item.caseId} itemId={item.id} links={links.filter(link=>'kind' in link&&link.kind==='transcript_finding')} save={p.work.transcriptLink} withdraw={p.work.withdrawTranscriptLink} inspect={p.inspect}/>
    {adding && (claims.length ? <form className="work-link-form" onSubmit={event => void submit(event)}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <fieldset disabled={busy}>
        <label className="form-label">Source-linked claim<select name="claimId" required>{claims.map(c => <option key={c.id} value={c.id}>{c.text} · {c.status}</option>)}</select></label>
        <label className="form-label">How does it relate?<select name="relation"><option value="supports">Supporting material</option><option value="contradicts">Contrary material</option><option value="context">Context only</option></select></label>
        <label className="form-label">Why is this relevant?<textarea name="reason" required maxLength={3000} rows={2}/></label>
        <button className="secondary" type="submit">{busy ? 'Checking original…' : 'Save source link'}</button>
      </fieldset>
    </form> : <Notice>Register evidence and propose an exact source-linked claim first. <button className="text-button" onClick={() => p.go('Evidence')}>Open evidence vault</button></Notice>)}
  </div>;
}

function WorkRecord({p, item, selection}: {p: ViewProps; item: WorkItem; selection?:{checked:boolean;disabled:boolean;toggle:()=>void}}) {
  const [editing, setEditing] = useState(false);
  const [revisions, setRevisions] = useState<WorkRevision[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const owner = p.data.members.find(m => m.caseId === item.caseId && m.userId === item.ownerId);
  const parent = p.data.workItems.find(w => w.id === item.parentId && w.caseId === item.caseId);
  const overdue = item.dueDate && item.dueDate < new Date().toISOString().slice(0, 10) && !done.has(item.status);
  async function history() {
    if (revisions) { setRevisions(null); return; }
    setLoading(true); setError('');
    try { setRevisions(await p.work.history(item.id)); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  return <article id={`work-${item.id}`} className={`work-record ${item.status === 'Blocked' ? 'work-blocked' : ''}`}>
    {selection&&<label className="checkbox-row task-selection"><input type="checkbox" checked={selection.checked} disabled={selection.disabled} onChange={selection.toggle} aria-label={`Select task: ${item.title}`}/><span>Select for status change</span></label>}
    <div className="work-record-top"><h3>{item.title}</h3><Badge tone={done.has(item.status) ? 'teal' : item.status === 'Blocked' ? 'amber' : 'neutral'}>{item.status}</Badge></div>
    {parent && <p className="small muted work-parent">For: {parent.title}</p>}
    {item.body && <p className="work-body">{item.body}</p>}
    <div className="work-record-meta"><span>{owner?.name ?? (item.ownerId ? 'Former case member' : 'Unassigned')}</span>
      {item.dueDate && <span className={overdue ? 'amber-text' : ''}><CalendarDays size={13}/>{overdue ? 'Overdue · ' : ''}{dateLabel(item.dueDate)}</span>}
      <span>v{item.version}</span></div>
    {['question', 'hypothesis', 'objective'].includes(item.kind) && <details className="work-detail"><summary aria-label={`Review material for ${item.title}`}>Review linked material</summary><SourceLinks p={p} item={item}/></details>}
    <div className="work-record-actions"><button className="text-button" aria-label={`Revise ${item.kind}: ${item.title}`} onClick={() => setEditing(!editing)}>{editing ? 'Cancel revision' : 'Revise record'}</button>
      <button className="text-button" aria-label={`History for ${item.title}`} onClick={() => void history()} disabled={loading}><History size={14}/>{loading ? 'Loading history…' : revisions ? 'Hide history' : 'History'}</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <details className="work-detail"><summary>Team discussion</summary><WorkDiscussion key={item.caseId+':'+item.id} itemId={item.id} members={p.data.members.filter(m=>m.caseId===item.caseId)} api={p.work.discussion}/></details>
    {editing && <WorkForm p={p} kind={item.kind} item={item} onClose={() => {setEditing(false); setRevisions(null);}}/>}
    {revisions && <div className="work-history" aria-label={`History for ${item.title}`}>
      {revisions.map(revision => <details key={revision.version}><summary>Version {revision.version} · {revision.reason}</summary>{revision.sources&&<ul aria-label="Sources at this revision">{revision.sources.map(link=><li key={link.id}>{link.relation}: {'kind' in link ? `${link.kind==='document_finding'?'Document':'Transcript'} finding ${link.findingId}` : `Text claim ${link.claimId}`} — {link.reason}</li>)}</ul>}
        <p className="small muted">{revision.actor} · {atLabel(revision.at)}</p><strong>{revision.item.title}</strong>
        <p className="work-body">{revision.item.body || 'No details recorded.'}</p><Badge>{revision.item.status}</Badge>
      </details>)}
    </div>}
  </article>;
}

export function WorkSection({p, kind, title, description}: {p: ViewProps; kind: WorkKind; title: string; description: string}) {
  const [adding, setAdding] = useState(false);
  const items = p.data.workItems.filter(w => w.caseId === p.active.id && w.kind === kind);
  return <Panel title={title} meta={p.work.enabled ? <button className="text-button" onClick={() => setAdding(!adding)}><Plus size={14}/>{adding ? 'Cancel' : `Add ${labels[kind]}`}</button> : undefined}>
    {!p.work.enabled ? <div className="panel-body"><p className="body-copy">{description}</p><button className="secondary" onClick={() => p.open('connect')}>Open persistent lab<ArrowUpRight size={14}/></button></div>
      : <><p className="work-section-description">{description}</p>
        {adding && <div className="work-editor-wrap"><WorkForm p={p} kind={kind} onClose={() => setAdding(false)}/></div>}
        {items.length ? items.map(item => <WorkRecord key={item.id} p={p} item={item}/>)
          : !adding && <Empty title={`No ${title.toLowerCase()} recorded`}>{`Add a ${labels[kind]} to keep the investigation's work and decisions together.`}</Empty>}
      </>}
  </Panel>;
}

export function CaseWorkDashboard({p}: {p: ViewProps}) {
  const items = p.data.workItems.filter(w => w.caseId === p.active.id);
  const questions = items.filter(w => w.kind === 'question' && w.status !== 'Resolved');
  const blocked = items.filter(w => w.status === 'Blocked');
  const next = items.filter(w => w.kind === 'task' && !done.has(w.status)).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))[0];
  return <>
    {p.work.enabled&&<WorkMentions key={p.active.id} api={p.work.discussion} onOpen={id=>{const item=p.data.workItems.find(w=>w.caseId===p.active.id&&w.id===id);p.go(item?.kind==='task'?'Tasks':'Brief');requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById('work-'+id)?.scrollIntoView({block:'center'})));}}/>}
    {p.work.enabled && <div className="case-work-summary" aria-label="Case progress">
      <div><strong>{p.data.findings.filter(f => f.caseId === p.active.id).length}</strong><span>Reviewed findings</span></div>
      <div><strong>{questions.length}</strong><span>Unresolved questions</span></div>
      <div><strong>{blocked.length}</strong><span>Blocked records</span></div>
      <div className="next-action"><span>Next action</span><strong>{next?.title ?? 'Set the next task'}</strong><button className="text-button" onClick={() => p.go('Tasks')}>Open tasks<ArrowUpRight size={13}/></button></div>
    </div>}
    <div className="two-columns work-grid"><WorkSection p={p} kind="objective" title="Objectives" description="Define what a completed investigation must establish."/>
      <WorkSection p={p} kind="question" title="Investigation questions" description="Track uncertainty, supporting material and outstanding checks."/></div>
    <WorkSection p={p} kind="hypothesis" title="Competing hypotheses" description="Record possible explanations and contrary material. A hypothesis is separate from a reviewed finding."/>
    <div className="two-columns work-grid"><WorkSection p={p} kind="note" title="Case notes" description="Keep working context and corrections in the case history."/>
      <WorkSection p={p} kind="handover" title="Handovers" description="Assign context and next actions to a recipient. Only that recipient can acknowledge receipt."/></div>
  </>;
}

export function CaseTaskboard(p: ViewProps) {
  const [adding,setAdding]=useState(false),[query,setQuery]=useState('');
  const [selected,setSelected]=useState<WorkItem[]>([]),[status,setStatus]=useState<TaskStatusBatch['status']>('In progress'),[reason,setReason]=useState('');
  const [mode,setMode]=useState<'status'|'plan'>('status'),[owner,setOwner]=useState('keep'),[deadline,setDeadline]=useState<'keep'|'set'|'clear'>('keep'),[dueDate,setDueDate]=useState('');
  const [pending,setPending]=useState<TaskStatusBatch|TaskPlanBatch|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[denied,setDenied]=useState(false);
  const working=useRef(false);
  function clear(){setSelected([]);setPending(null);setReason('');setOwner('keep');setDeadline('keep');setDueDate('');}
  async function act(run:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);setError('');
    try{await run();}catch(e){const failure=e as Error&{statusCode?:number};setError(failure.message);
      if([401,403,404].includes(failure.statusCode??0)){clear();setDenied(true);void p.work.refresh().catch(()=>{});}
    }finally{working.current=false;setBusy(false);}
  }
  async function refresh(){clear();setNotice('');setDenied(true);await p.work.refresh();setDenied(false);}
  async function save(event?:FormEvent){event?.preventDefault();await act(async()=>{
    if(!pending&&mode==='plan'&&owner==='keep'&&deadline==='keep')throw new Error('Choose an owner or deadline change.');
    const input=pending??{id:crypto.randomUUID(),items:selected.map(item=>({id:item.id,expectedVersion:item.version})),reason,...(mode==='status'?{status}:{...(owner==='keep'?{}:{ownerChange:{ownerId:owner||null}}),...(deadline==='keep'?{}:{dueDateChange:{dueDate:deadline==='clear'?null:dueDate}})})};
    setNotice('');setPending(input);const result='status' in input?await p.work.batchStatus(input):await p.work.batchPlan(input);clear();setDenied(true);setNotice('Task receipt confirmed. Loading current task records…');
    await p.work.refresh();setDenied(false);setNotice(`Recorded ${'status' in input?'status':'assignment/deadline'} changes for ${result.applied.length} tasks. Individual histories retain the decision.`);
  });}
  if(!p.work.enabled)return <WorkSection p={p} kind="task" title="Case tasks" description="Save assignments, deadlines, blockers and completion decisions with the case."/>;
  const tasks=p.data.workItems.filter(w=>w.caseId===p.active.id&&w.kind==='task'&&`${w.title} ${w.body}`.toLowerCase().includes(query.toLowerCase()));
  const frozen=busy||!!pending;
  return <>
    <div className="toolbar"><label className="search-input"><Search size={16}/><input aria-label="Filter case tasks" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a task…"/></label>
      <button className="secondary" disabled={busy} onClick={()=>void act(refresh)}>Refresh tasks</button><button className="primary" disabled={denied||frozen} onClick={()=>setAdding(!adding)}><Plus size={15}/>{adding?'Cancel task':'Add task'}</button></div>
    {error&&<p role="alert" className="form-error">{error} {pending?'Retry the unchanged batch, or refresh and select current tasks.':'Refresh to load current case work.'}</p>}
    {notice&&<p role="status">{notice}</p>}
    {denied?<Notice>Current tasks are unavailable. Refresh to check access and load them again.</Notice>:<>
      {adding&&<WorkForm p={p} kind="task" onClose={()=>setAdding(false)}/>}
      <Panel title={mode==='status'?"Change selected task statuses":"Plan selected tasks"} meta={<Badge>{selected.length} / 50 selected</Badge>}>
        <div className="panel-body"><p className="body-copy">Select tasks below, choose status or assignment/deadline changes and record one reason. Every selected version must still be current. The whole batch is saved together with each task’s history.</p>
          {!!selected.length&&<><ul aria-label="Selected task versions">{selected.map(item=><li key={item.id}>{item.title} · v{item.version} · {item.status}</li>)}</ul>
            <form aria-label={mode==='status'?'Task status batch':'Task planning batch'} className="work-form" onSubmit={e=>void save(e)}><fieldset disabled={frozen}>
              <label className="form-label">Batch change<select name="mode" value={mode} onChange={e=>setMode(e.target.value as 'status'|'plan')}><option value="status">Status</option><option value="plan">Owner and deadline</option></select></label>
              {mode==='status'?
              <label className="form-label">New task status<select name="status" value={status} onChange={e=>setStatus(e.target.value as TaskStatusBatch['status'])}>{workStatuses.task.map(value=><option key={value}>{value}</option>)}</select></label>:<>
                <label className="form-label">New task owner<select name="owner" value={owner} onChange={e=>setOwner(e.target.value)}><option value="keep">Keep each current owner</option><option value="">Unassigned</option>{p.data.members.filter(m=>m.caseId===p.active.id).map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
                <label className="form-label">Deadline change<select name="deadline" value={deadline} onChange={e=>setDeadline(e.target.value as 'keep'|'set'|'clear')}><option value="keep">Keep each current deadline</option><option value="set">Set a deadline</option><option value="clear">Remove deadline</option></select></label>
                {deadline==='set'&&<label className="form-label">New deadline<input name="dueDate" type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>}
                <p className="small">Keeping a field preserves its value on each task. Unassigned and Remove deadline explicitly clear it. Task status stays unchanged.</p>
              </>}
              <label className="form-label">{mode==='status'?'Reason for these status changes':'Reason for these planning changes'}<textarea name="reason" required minLength={10} maxLength={3000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
              <button className="primary">{mode==='status'?'Save selected task statuses':'Save selected task plan'}</button>
            </fieldset></form>
            {pending&&<button className="primary" disabled={busy} onClick={()=>void save()}>Retry unchanged task batch</button>}
            <button className="text-button" disabled={busy} onClick={()=>void act(refresh)}>Discard selection and refresh tasks</button>
          </>}
        </div>
      </Panel>
      <div className="kanban work-kanban">{workStatuses.task.map(column=><section key={column}>
        <div className="kanban-heading"><h2>{column}</h2><Badge>{tasks.filter(t=>t.status===column).length}</Badge></div>
        {tasks.filter(t=>t.status===column).map(item=>{const checked=selected.some(s=>s.id===item.id);return <WorkRecord key={item.id} p={p} item={item} selection={{checked,disabled:frozen||(!checked&&selected.length>=50),toggle:()=>{setNotice('');setError('');setSelected(old=>checked?old.filter(s=>s.id!==item.id):[...old,item]);}}}/>;})}
        {!tasks.some(t=>t.status===column)&&<p className="work-column-empty">{query?'No matching tasks':'No tasks'}</p>}
      </section>)}</div>
    </>}
  </>;
}
