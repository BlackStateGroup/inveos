import {useEffect,useRef,useState} from 'react';
import {Panel,Notice} from './ui';
type Job={id:string;evidenceId:string;kind:string;status:string;attempt:number;authorityVersion:number;sourceDigest:string;failureCode:string|null};
type Event={id:string;status:string;attempt:number;failureCode:string|null;recordedAt:string};
type Page={items:Job[];nextBefore:string|null};
export function ProcessingJobs({caseId,csrf}:{caseId:string;csrf:string}){
  const [rows,setRows]=useState<Job[]>([]),[next,setNext]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const [history,setHistory]=useState<{jobId:string;items:Event[];nextAfter:string|null}|null>(null);
  const alive=useRef(true),locked=useRef(false),base=`/api/cases/${caseId}/integrity-jobs`;
  async function get<T>(url:string,signal?:AbortSignal):Promise<T>{const r=await fetch(url,{credentials:'same-origin',signal});const value=await r.json();if(!r.ok)throw new Error(value.error||'Processing history unavailable.');return value;}
  useEffect(()=>{alive.current=true;const controller=new AbortController();
    void get<Page>(base,controller.signal).then(p=>{if(!controller.signal.aborted){setRows(p.items);setNext(p.nextBefore);}})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>{alive.current=false;controller.abort();};
  },[base]);
  async function act(operation:()=>Promise<void>){if(locked.current)return;locked.current=true;setBusy(true);setError('');
    try{await operation();}catch(e){if(alive.current)setError((e as Error).message);}finally{locked.current=false;if(alive.current)setBusy(false);}}
  async function load(older=false){const p=await get<Page>(`${base}${older&&next?`?before=${next}`:''}`);if(!alive.current)return;
    setRows(old=>older?[...old,...p.items.filter(x=>!old.some(y=>y.id===x.id))]:p.items);setNext(p.nextBefore);setHistory(null);}
  async function events(jobId:string,after?:string){const p=await get<{items:Event[];nextAfter:string|null}>(`${base}/${jobId}/events${after?`?after=${after}`:''}`);
    if(alive.current)setHistory(old=>({jobId,items:after&&old?.jobId===jobId?[...old.items,...p.items]:p.items,nextAfter:p.nextAfter}));}
  async function cancel(job:Job){const r=await fetch(`${base}/${job.id}/cancel`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'});
    const value=await r.json();if(!r.ok)throw new Error(value.error||'Cancellation failed.');if(!alive.current)return;
    setRows(old=>old.map(x=>x.id===job.id?value:x));await events(job.id);}
  return <Panel title="Original processing history"><div className="panel-body">
    <Notice>Checks and text indexes remain separate from findings. Successful processing does not clear binary quarantine or approve a citation. A trusted worker must execute queued jobs.</Notice>
    <button className="secondary" disabled={busy} onClick={()=>void act(()=>load())}>Refresh processing jobs</button>
    {error&&<p role="alert" className="form-error">{error} Refresh to retry.</p>}
    <p role="status">{busy?'Loading processing jobs…':!rows.length?'No processing jobs for this case.':''}</p>
    <ul>{rows.map(job=><li key={job.id}><strong>{job.kind==='utf8_line_index_v1'?'UTF-8 line index':'Original SHA-256 check'} · {job.status}</strong>
      <p>Evidence {job.evidenceId} · attempt {job.attempt} · authority version {job.authorityVersion}</p>
      <p>Original SHA-256: {job.sourceDigest}</p>{job.failureCode&&<p>Failure: {job.failureCode}</p>}
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>events(job.id))}>View attempts {job.id.slice(0,8)}</button>
      {['queued','running'].includes(job.status)&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>cancel(job))}>Cancel job {job.id.slice(0,8)}</button>}
    </li>)}</ul>
    {next&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>load(true))}>Older jobs</button>}
    {history&&<section aria-label="Selected job attempts"><h3>Attempts for {history.jobId}</h3><ol>{history.items.map(e=><li key={e.id}>{e.status} · attempt {e.attempt} · {new Date(e.recordedAt).toISOString()} {e.failureCode||''}</li>)}</ol>
      {history.nextAfter&&<button disabled={busy} className="secondary" onClick={()=>void act(()=>events(history.jobId,history.nextAfter!))}>More attempts</button>}</section>}
  </div></Panel>;
}
