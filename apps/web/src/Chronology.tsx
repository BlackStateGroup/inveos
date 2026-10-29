import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {ChronologyEdit,ChronologyEvent,ChronologyInput,ChronologyRevision,ChronologySource,DocumentReportFinding,ReportDraft} from '@inveos/contracts';
import {Badge,Empty,Notice,Panel} from './ui';

type Source = ReportDraft['findings'][number] | DocumentReportFinding;
type Candidate = ChronologySource & {text:string};
export function Chronology({caseId,csrf,inspect}:{caseId:string;csrf:string;inspect:(id:string)=>void}){
 const [items,setItems]=useState<ChronologyEvent[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [form,setForm]=useState<ChronologyEvent|'new'|null>(null),[sources,setSources]=useState<Candidate[]>([]),[history,setHistory]=useState<ChronologyRevision[]|null>(null),[source,setSource]=useState<Source|null>(null),[query,setQuery]=useState('');
 const lock=useRef(false),requestId=useRef(crypto.randomUUID()),base=`/api/cases/${caseId}/chronology`;
 async function api<T>(url:string,input?:object):Promise<T>{
  const response=await fetch(url,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:input?{'content-type':'application/json','x-csrf-token':csrf}:{},...(input?{body:JSON.stringify(input)}:{})});
  const value=await response.json();if(!response.ok){if([401,403,404].includes(response.status)){setItems([]);setHistory(null);setSource(null);}throw new Error(value.error||'Chronology unavailable.');}return value;
 }
 async function refresh(){setSource(null);setHistory(null);const data=await api<{items:ChronologyEvent[]}>(base);setItems(data.items);setLoaded(true);}
 async function act(run:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await run();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
 useEffect(()=>{const controller=new AbortController();void fetch(base,{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async r=>{const value=await r.json();if(!r.ok)throw new Error(value.error||'Chronology unavailable.');if(!controller.signal.aborted){setItems(value.items);setLoaded(true);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[base]);
 async function edit(event:ChronologyEvent|'new'){await act(async()=>{setSources(await api<Candidate[]>(base+'/sources'));requestId.current=crypto.randomUUID();setForm(event);setHistory(null);setSource(null);});}
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const fields=new FormData(e.currentTarget),current=form&&form!=='new'?form:null;
  const candidate=sources.find(s=>s.kind+':'+s.findingId===fields.get('source'));
  await act(async()=>{if(!candidate)throw new Error('Choose a source finding.');
   const input={title:String(fields.get('title')),account:String(fields.get('account')),status:String(fields.get('status')) as ChronologyInput['status'],source:{kind:candidate.kind,findingId:candidate.findingId},time:{precision:String(fields.get('precision')) as ChronologyInput['time']['precision'],start:String(fields.get('start')).trim()||null,end:String(fields.get('end')).trim()||null,timezone:String(fields.get('timezone')),note:String(fields.get('note'))}};
   if(current)await api(base+'/'+current.id+'/revise',{...input,expectedVersion:current.version,reason:String(fields.get('reason'))} satisfies ChronologyEdit);
   else await api(base,{...input,id:requestId.current} satisfies ChronologyInput);
   setForm(null);setHistory(null);setSource(null);await refresh();
  });
 }
 const current=form&&form!=='new'?form:undefined;
 const filtered=items.filter(e=>[e.title,e.account,e.time.note,e.time.start??'',e.time.end??'',e.status].some(s=>s.toLocaleLowerCase('en-GB').includes(query.toLocaleLowerCase('en-GB'))));
 return <Panel title="Alleged events" meta={<Badge>Accounts remain separate from findings</Badge>}><div className="panel-body">
  <Notice>Recorded order does not establish event sequence. Keep competing accounts separate. Date-only and month-only values retain their stated precision; no time or timezone is inferred.</Notice>
  <div className="work-record-actions"><button className="primary" disabled={busy} onClick={()=>void edit('new')}>Record an alleged event</button><button className="secondary" disabled={busy} onClick={()=>void act(refresh)}>Refresh chronology</button></div>
  <label className="form-label">Search chronology<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
  {error&&<p className="form-error" role="alert">{error} Unsaved edits remain below. Refresh and compare before reopening a conflicting revision.</p>}
  {busy&&<p role="status">Checking chronology…</p>}
  {form&&<form className="work-form" aria-label="Chronology account" key={current?.id??'new'} onSubmit={e=>void submit(e)}><fieldset disabled={busy}>
   <h3>{current?'Correct account':'Record account'}</h3>
   <label className="form-label">Event title<input name="title" required minLength={3} maxLength={200} defaultValue={current?.title}/></label>
   <label className="form-label">Account<textarea name="account" required maxLength={4000} defaultValue={current?.account}/></label>
   <label className="form-label">Account status<select name="status" defaultValue={current?.status??'alleged'}><option value="alleged">Alleged</option><option value="disputed">Disputed</option><option value="withdrawn">Withdrawn</option></select></label>
   <label className="form-label">Date precision<select name="precision" defaultValue={current?.time.precision??'unknown'}>{['unknown','instant','day','month','range'].map(p=><option key={p}>{p}</option>)}</select></label>
   <div className="work-form-grid"><label className="form-label">Alleged date / range start<input name="start" maxLength={40} defaultValue={current?.time.start??''} placeholder="2026-10 or 2026-10-01 or timestamp with offset"/></label><label className="form-label">Range end<input name="end" maxLength={40} defaultValue={current?.time.end??''} placeholder="Only for a range: timestamp with offset"/></label></div>
   <p className="small muted">For an instant or range: 2026-10-01T09:00:00+01:00. Leave dates blank when unknown. A day or month is a calendar label, not midnight UTC.</p>
   <label className="form-label">Timezone as stated in the account<input name="timezone" maxLength={100} defaultValue={current?.time.timezone??''} placeholder="Leave blank if not stated"/></label>
   <label className="form-label">Date uncertainty and basis<textarea name="note" required maxLength={1000} defaultValue={current?.time.note}/></label>
   <label className="form-label">Source finding<select name="source" required defaultValue={current?current.source.kind+':'+current.source.findingId:''}><option value="">Choose an existing reviewed source</option>{sources.map(s=><option key={s.kind+':'+s.findingId} value={s.kind+':'+s.findingId}>{s.kind==='document_finding'?'Document':'Text'}: {s.text}</option>)}</select></label>
   <p className="small muted">Saving checks the source bytes, citation and current authority. The account itself is not a reviewed finding.</p>
   {current&&<label className="form-label">Correction reason<textarea name="reason" required maxLength={3000}/></label>}
   <div className="work-form-actions"><button type="button" className="secondary" onClick={()=>setForm(null)}>Cancel account edit</button><button type="submit" className="primary">{current?'Save account correction':'Save alleged event'}</button></div>
  </fieldset></form>}
  {!loaded&&!error?<p>Loading chronology…</p>:!items.length?<Empty title="No alleged events recorded">Add an account after reviewing its source passage.</Empty>:!filtered.length?<p>No matching accounts.</p>:filtered.map(event=><article className="work-record" key={event.id}>
   <div className="work-record-top"><h3>{event.title}</h3><Badge>{event.status} · v{event.version}</Badge></div>
   <p><strong>Alleged date:</strong> {event.time.precision} · {event.time.start??'Unknown'}{event.time.end?' to '+event.time.end:''}</p><p className="small">Stated timezone: {event.time.timezone||'Not specified'}</p>
   <p>{event.time.note}</p><p className="work-body">{event.account}</p><small>Account recorded: {event.recordedAt} · source finding {event.source.findingId}</small>
   <div className="work-record-actions"><button className="text-button" disabled={busy} onClick={()=>void edit(event)}>Correct {event.title}</button><button className="text-button" disabled={busy} onClick={()=>void act(async()=>{setHistory(null);setHistory(await api<ChronologyRevision[]>(base+'/'+event.id+'/history'));})}>History: {event.title}</button><button className="text-button" disabled={busy} onClick={()=>void act(async()=>{setSource(null);setSource(await api<Source>(base+'/'+event.id+'/source'));})}>Inspect source: {event.title}</button></div>
  </article>)}
  {history&&<section className="work-history" aria-label="Chronology correction history"><h3>Correction history</h3>{history.map(r=><details key={r.event.version}><summary>Version {r.event.version}: {r.reason}</summary><p>{r.actor} · {r.at}</p><p>{r.event.title}: {r.event.account}</p><p>{r.event.status} · {r.event.time.precision} · {r.event.time.start??'Unknown'} {r.event.time.end??''}</p><p>{r.event.time.note} · {r.event.time.timezone||'Timezone unspecified'}</p><p>Historical source finding: {r.event.source.findingId}</p></details>)}</section>}
  {source&&<section aria-label="Chronology source"><h3>{source.source.filename}</h3><blockquote>{'kind' in source?source.reference.quote:source.source.quote}</blockquote><p>Source-recorded time: {source.source.sourceTime}</p><p>Received time: {source.source.receivedTime}</p><p>Reviewed: {source.reviewedAt}</p>{'kind' in source&&<p>Processed: {source.extraction.processedAt} · page {source.reference.page}</p>}<p className="digest">SHA-256: {source.source.sha256}</p><button className="text-button" onClick={()=>inspect(source.source.id)}>Open chronology original</button></section>}
 </div></Panel>;
}
