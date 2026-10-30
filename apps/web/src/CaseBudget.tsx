import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {CaseBudgetSnapshot,CaseBudgetVersion} from '@inveos/contracts';
import {Badge,Notice,Panel} from './ui';
import './case-time.css';

type History={items:CaseBudgetVersion[];next:number|null};
type Edit={id:string;expectedVersion:number;withdraw:boolean};
export function CaseBudget({caseId,csrf,onDenied}:{caseId:string;csrf:string;onDenied:()=>Promise<unknown>}){
 const base=`/api/cases/${caseId}/time-budget`,controller=useRef(new AbortController()),working=useRef(false);
 const [snapshot,setSnapshot]=useState<CaseBudgetSnapshot|null>(null),[history,setHistory]=useState<History|null>(null),[editor,setEditor]=useState<Edit|null>(null);
 const [minutes,setMinutes]=useState(0),[reason,setReason]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 function clear(){setSnapshot(null);setHistory(null);setEditor(null);setMinutes(0);setReason('');setNotice('');}
 async function api<T>(path:string,input?:object):Promise<T>{
  const r=await fetch(base+path,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.current.signal,AbortSignal.timeout(30000)]),headers:input?{'content-type':'application/json','x-csrf-token':csrf}:{},...(input?{body:JSON.stringify(input)}:{})});
  const value=await r.json();if(!r.ok){if([401,403,404].includes(r.status)){clear();void onDenied().catch(()=>{});}throw new Error(value.error||'Case budget unavailable.');}return value;
 }
 async function act(work:()=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');try{await work();}catch(e){if(!controller.current.signal.aborted)setError((e as Error).message);}finally{working.current=false;if(!controller.current.signal.aborted)setBusy(false);}}
 async function load(){clear();setSnapshot(await api(''));}
 useEffect(()=>{const abort=new AbortController();controller.current=abort;working.current=true;setBusy(true);
  void api<CaseBudgetSnapshot>('').then(v=>{if(!abort.signal.aborted)setSnapshot(v);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted){working.current=false;setBusy(false);}});return()=>abort.abort();
 },[base]);
 function edit(withdraw=false){if(!snapshot)return;setEditor({id:crypto.randomUUID(),expectedVersion:snapshot.current?.version??0,withdraw});setMinutes(snapshot.current?.minutes??0);setReason('');setHistory(null);setError('');setNotice('');}
 async function save(e:FormEvent){e.preventDefault();if(!editor)return;const edit=editor;await act(async()=>{
  const result=await api<CaseBudgetSnapshot>(edit.withdraw?'/withdraw':'',{id:edit.id,expectedVersion:edit.expectedVersion,reason,...(edit.withdraw?{}:{minutes})});
  setSnapshot(result);setEditor(null);setReason('');setHistory(null);setNotice('Budget decision saved. Current version '+result.current!.version+'.');
 });}
 async function past(before?:number){setHistory(null);setHistory(await api('/history'+(before?'?before='+before:'')));}
 const active=snapshot?.current&&snapshot.current.action!=='withdrawn'?snapshot.current:null;
 return <Panel title="Case time budget" meta={<Badge>Reviewer planning</Badge>} className="case-time"><div className="panel-body" aria-label="Case time budget">
  <Notice>Plan declared work time for this case. Totals use the latest active ledger entries, including former colleagues’ retained time. Overlaps are counted as declared; chargeable designations are not approved charges. This budget does not stop evidence intake.</Notice>
  <div className="work-record-actions"><button className="secondary" disabled={busy} onClick={()=>void act(load)}>Refresh case budget</button>{snapshot&&<><button className="primary" disabled={busy||(snapshot.current?.version??0)>=999} onClick={()=>edit()}>{active?'Revise time budget':'Set time budget'}</button>{active&&<button className="secondary" disabled={busy||active.version>=1000} onClick={()=>edit(true)}>Withdraw time budget</button>}</>}</div>
  {busy&&<p role="status">Checking case budget…</p>}{error&&<p role="alert" className="form-error">{error} Retry an unchanged submission after a lost response. Refresh to compare saved decisions; it discards unsent edits.</p>}{notice&&<p role="status">{notice}</p>}
  {snapshot?.current&&snapshot.current.version>=999&&<p className="small">{snapshot.current.version===999?'Allocation history limit reached. The final decision remains available for withdrawal.':'Budget history limit reached. All recorded decisions remain available.'}</p>}
  {snapshot&&<section aria-label="Budget and declared usage" data-case-id={snapshot.caseId}><h3>{active?active.minutes.toLocaleString()+' minutes allocated':'No active time budget'}</h3>
   <dl className="time-facts"><dt>Declared active time</dt><dd>{snapshot.usage.minutes.toLocaleString()} minutes across {snapshot.usage.entries} {snapshot.usage.entries===1?'entry':'entries'}</dd><dt>Marked chargeable</dt><dd>{snapshot.usage.markedChargeableMinutes.toLocaleString()} minutes</dd><dt>Planning balance</dt><dd>{snapshot.remainingMinutes===null?'No allocation to compare':snapshot.remainingMinutes<0?Math.abs(snapshot.remainingMinutes).toLocaleString()+' minutes over allocation':snapshot.remainingMinutes.toLocaleString()+' minutes remaining'}</dd><dt>Snapshot recorded</dt><dd>{snapshot.observedAt}</dd></dl>
   <p className="small">These are whole-case totals at the recorded snapshot, not a live timer or invoice. Refresh after recording, correcting or withdrawing time.</p>
   {snapshot.current&&<><p>Budget version {snapshot.current.version} · {snapshot.current.action} · {snapshot.current.actorName} · {snapshot.current.recordedAt}</p><p className="work-body">{snapshot.current.reason}</p><button className="text-button" disabled={busy} onClick={()=>void act(()=>past())}>Budget decision history</button></>}
  </section>}
  {editor&&<form className="work-form" aria-label="Case budget decision" onSubmit={e=>void save(e)}><fieldset disabled={busy}><h3>{editor.withdraw?'Withdraw the planning allocation':'Record a planning allocation'}</h3>
   {editor.withdraw?<p>Withdrawal retains all budget and time history. A new allocation needs another explicit decision.</p>:<label className="form-label">Allocated minutes<input name="minutes" type="number" required min={0} max={14400000} step={1} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>}
   <label className="form-label">Budget decision reason<textarea name="reason" required minLength={10} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <div className="work-form-actions"><button type="button" className="secondary" onClick={()=>{setEditor(null);setReason('');}}>Cancel budget edit</button><button className="primary">{editor.withdraw?'Record budget withdrawal':'Save time budget'}</button></div>
  </fieldset></form>}
  {history&&<section className="work-history" aria-label="Budget decision history"><h4>Retained budget decisions</h4>{history.items.map(item=><details key={item.version}><summary>v{item.version} · {item.action} · {item.minutes} minutes · {item.recordedAt}</summary><p>{item.actorName}</p><p className="work-body">{item.reason}</p></details>)}<div className="work-record-actions"><button className="text-button" disabled={busy} onClick={()=>void act(()=>past())}>Latest budget decisions</button>{history.next&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>past(history.next!))}>Earlier budget decisions</button>}</div></section>}
 </div></Panel>;
}
