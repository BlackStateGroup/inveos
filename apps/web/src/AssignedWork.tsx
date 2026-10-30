import {TeamWorkload} from './TeamWorkload';
import type {Case} from '@inveos/contracts';
import {useEffect,useRef,useState} from 'react';
import {workStatuses,type AssignedWorkEntry,type AssignedWorkPage,type WorkKind} from '@inveos/contracts';
import {Badge,Notice,Panel,SectionTitle} from './ui';
type Cursor=AssignedWorkPage['next'];
function PersonalWork({openWork}:{openWork:(item:AssignedWorkEntry)=>Promise<void>}){
 const [kind,setKind]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState<AssignedWorkPage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[cursor,setCursor]=useState<Cursor>(null),[previous,setPrevious]=useState<Cursor[]>([]);
 const pending=useRef<AbortController|null>(null),live=useRef(true),loading=useRef(false),reload=useRef<()=>void>(()=>{});
 const statuses=kind?workStatuses[kind as WorkKind]:[...new Set(Object.values(workStatuses).flat())];
 useEffect(()=>{live.current=true;return()=>{live.current=false;pending.current?.abort();};},[]);
 useEffect(()=>{setCursor(null);setPrevious([]);void load(null,[]);return()=>pending.current?.abort();},[kind,status]);
 async function load(next:Cursor=cursor,back=previous){pending.current?.abort();const controller=new AbortController();pending.current=controller;loading.current=true;setBusy(true);setError('');setPage(null);setCursor(next);setPrevious(back);
  const query=new URLSearchParams();if(kind)query.set('kind',kind);if(status)query.set('status',status);if(next){query.set('afterId',next.id);query.set('afterDue',next.dueDate??'none');}
  reload.current=()=>void load(next,back);
  try{const response=await fetch('/api/work/queue?'+query,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}),value=await response.json();if(!response.ok)throw new Error(value.error||'Assigned work unavailable.');if(!controller.signal.aborted)setPage(value);}
  catch(e){if(!controller.signal.aborted&&live.current)setError((e as Error).message);}finally{if(!controller.signal.aborted&&live.current){loading.current=false;setBusy(false);}}
 }
 async function open(item:AssignedWorkEntry){if(loading.current)return;loading.current=true;setBusy(true);setError('');try{await openWork(item);}catch(e){if(live.current){setPage(null);setError((e as Error).message);}}finally{if(live.current){loading.current=false;setBusy(false);}}}
 return <><SectionTitle eyebrow="ASSIGNMENTS / MY WORK" title="Your assigned work." description="Find work across the cases you can currently access, then open it in case context."/><Notice>Only your current assignments in accessible cases appear here. Dates are recorded deadlines; this queue sends no notifications and does not change any work or review state.</Notice><Panel title="Personal work queue" meta={<Badge>{page?.items.length??0} on this page</Badge>}><div className="panel-body">
 <div className="work-form-grid"><label className="form-label">Work kind<select value={kind} onChange={e=>{setKind(e.target.value);setStatus('');}}><option value="">All kinds</option>{Object.keys(workStatuses).map(k=><option key={k}>{k}</option>)}</select></label><label className="form-label">Work status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></label></div>
 <div className="work-record-actions"><button className="secondary" disabled={busy} onClick={()=>void load(null,[])}>Refresh assignments</button>{previous.length>0&&<button className="secondary" disabled={busy} onClick={()=>void load(previous.at(-1)!,previous.slice(0,-1))}>Previous assignments</button>}{page?.next&&<button className="secondary" disabled={busy} onClick={()=>void load(page.next,[...previous,cursor])}>Next assignments</button>}</div>
 {busy&&<p role="status">Loading assigned work…</p>}{error&&<div role="alert" className="form-error"><p>{error} Previously loaded assignments have been cleared.</p><button className="secondary" disabled={busy} onClick={()=>reload.current()}>Retry assignments</button></div>}
 {page&&!page.items.length&&<p>No assigned work matches these filters in your currently accessible cases.</p>}
 {page&&<section aria-label="Assigned work results">{page.items.map(item=><article className="work-record" key={item.caseId+':'+item.id}><div className="work-record-top"><h3>{item.title}</h3><Badge>{item.status}</Badge></div><p>{item.caseRef} · {item.caseTitle}</p><p className="work-body">{item.excerpt}</p><p className="small">{item.kind} · {item.dueDate?'Due '+item.dueDate:'No deadline recorded'} · version {item.version}</p><button className="secondary" disabled={busy} onClick={()=>void open(item)}>Open assigned work: {item.title}</button></article>)}</section>}
 <p className="small muted">Ordered by recorded deadline, with undated work last. Changes during paging may move work between pages; refresh to start again.</p>
 </div></Panel></>;
}

export function AssignedWork({openWork,cases=[],reviewer=false}:{openWork:(item:AssignedWorkEntry)=>Promise<void>;cases?:Case[];reviewer?:boolean}){
 const [team,setTeam]=useState(false);
 return <>{reviewer&&<div className="work-record-actions"><button className={team?'secondary':'primary'} onClick={()=>setTeam(false)}>My assignments</button><button className={team?'primary':'secondary'} onClick={()=>setTeam(true)}>Team workload</button></div>}{team&&reviewer?<TeamWorkload cases={cases} openWork={openWork}/>:<PersonalWork openWork={openWork}/>}</>;
}
