import {CitationReviewPanel} from './CitationReview';
import {useEffect,useRef,useState} from 'react';
import type {InspectedDocument} from './documentInspection';
import {citationScope,pendingCitation,saveCitationRecoverably,verifyCitation,type CitationReceipt,type PendingCitation} from './citationRequest';
export function DocumentCitations({document:d,csrf}:{document:InspectedDocument;csrf:string}){
  const [selected,setSelected]=useState(d.references[0]?.itemRef??''),[pending,setPending]=useState<PendingCitation|null>(null),[rows,setRows]=useState<CitationReceipt[]>([]),[next,setNext]=useState<string|null>(null);
  const [reviewId,setReviewId]=useState<string|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const alive=useRef(true),lock=useRef(false),scope=useRef(''),base=`/api/cases/${d.caseId}/integrity-jobs/${d.jobId}/document-citations`;
  async function read(url:string,signal?:AbortSignal){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});const value=await r.json();if(!r.ok)throw new Error(value.error||'Citation candidates unavailable.');return value;}
  async function load(after?:string,signal?:AbortSignal){
    const page=await read(`${base}${after?`?after=${after}`:''}`,signal) as {items:unknown[];nextAfter:string|null};
    if(!Array.isArray(page.items)||page.items.length>50)throw new Error('Citation list could not be verified.');
    const checked=await Promise.all(page.items.map(r=>verifyCitation(r,d)));
    if(checked.some((r,i)=>i>0&&r.id<=checked[i-1]!.id||after&&r.id<=after)||page.nextAfter!==null&&(checked.length!==50||page.nextAfter!==checked.at(-1)?.id))throw new Error('Citation list cursor could not be verified.');
    if(alive.current&&!signal?.aborted){setRows(old=>after?[...old,...checked]:checked);setNext(page.nextAfter);}
  }
  useEffect(()=>{alive.current=true;const c=new AbortController();
    void (async()=>{scope.current=await citationScope(csrf,d);if(c.signal.aborted)return;setPending(pendingCitation(window.sessionStorage,scope.current));await load(undefined,c.signal);})()
      .catch(e=>{if(!c.signal.aborted){setRows([]);setNext(null);setError(e.message);}}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
    return()=>{alive.current=false;c.abort();};
  // Parent keys this workspace by extraction and session, discarding stale requests on replacement.
  },[]);
  async function act(fn:()=>Promise<void>){if(lock.current||!scope.current)return;lock.current=true;setBusy(true);setError('');setMessage('');setReviewId(null);
    try{await fn();}catch(e){if(alive.current){setRows([]);setNext(null);setError((e as Error).message);}}
    finally{lock.current=false;if(alive.current){try{setPending(pendingCitation(window.sessionStorage,scope.current));}catch(e){setError((e as Error).message);}setBusy(false);}}
  }
  async function save(){
    const receipt=await saveCitationRecoverably(window.sessionStorage,scope.current,d,selected,async(p,selection)=>{
      const url=`${base}/${p.id}`,signal=AbortSignal.timeout(30000);
      // First recover a committed response, including historical authority; only 404 permits a new save.
      let r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});
      if(r.status===404)r=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',signal,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(selection)});
      const value=await r.json();if(!r.ok)throw new Error(value.error||'Citation save could not be confirmed. Recover the pending request.');return value;
    });
    if(!alive.current)return;await load();if(alive.current)setMessage(`Candidate ${receipt.id} saved as unreviewed. No finding was approved.`);
  }
  const ref=d.references.find(r=>r.itemRef===(pending?.itemRef??selected));
  return <section aria-label="Document citation candidates"><h3>Unreviewed citation candidates</h3>
    <p>Save an exact extracted passage for later human review. Saving does not approve its accuracy, clear quarantine or make it report eligible. The region covers the whole extracted item.</p>
    <label>Candidate passage<select value={pending?.itemRef??selected} disabled={busy||!!pending} onChange={e=>setSelected(e.target.value)}>{d.references.map(r=><option key={r.itemRef} value={r.itemRef}>Page {r.page} · {r.itemRef} · bytes {r.startByte}–{r.endByte}</option>)}</select></label>
    {ref&&<div><p>Candidate page {ref.page} · extracted UTF-8 bytes [{ref.startByte}, {ref.endByte})</p><pre className="source-excerpt">{ref.text}</pre></div>}
    <button className="primary" disabled={busy||!ref||new TextEncoder().encode(ref.text).length>4096} onClick={()=>void act(save)}>{pending?'Recover pending citation':'Save passage candidate'}</button>
    <p className="small muted">Whole passages up to 4096 UTF-8 bytes. Retry identity lasts for this tab and sign-in; saved candidates remain on the server and can be refreshed after reload. Refresh restarts pagination to include concurrent additions.</p>
    {pending&&<p role="status">Unconfirmed candidate {pending.id}. Recover before saving another passage.</p>}
    <button className="secondary" disabled={busy} onClick={()=>void act(()=>load())}>Refresh citation candidates</button>
    {error&&<p role="alert">{error}</p>}<p role="status">{busy?'Verifying citation candidates…':message}</p>
    <ol>{rows.map(r=><li key={r.id}><strong>Unreviewed candidate · page {r.citation.page}</strong><p>{r.id} · {r.citation.itemRef} · extracted bytes [{r.citation.startByte}, {r.citation.endByte})</p><pre className="source-excerpt">{r.citation.quote}</pre><p>Saved {r.createdAt} · author {r.createdBy} · SHA-256 {r.citationDigest}</p><button className="secondary" disabled={busy} onClick={()=>setReviewId(r.id)}>Review candidate {r.id.slice(0,8)}</button>{reviewId===r.id&&<CitationReviewPanel key={r.id} candidate={r} csrf={csrf}/>}</li>)}</ol>
    {!busy&&!error&&!rows.length&&<p>No saved candidates for this extraction.</p>}
    {next&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>load(next))}>More citation candidates</button>}
  </section>;
}
