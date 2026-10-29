import {useEffect,useRef,useState} from 'react';
import type {CitationReceipt} from './citationRequest';
import {verifyReviewHistory,type ReviewHistory,type ReviewRequest} from './citationReview';
import {DocumentClaims} from './DocumentClaims';
export function CitationReviewPanel({candidate,csrf}:{candidate:CitationReceipt;csrf:string}){
 const [history,setHistory]=useState<ReviewHistory|null>(null),[reason,setReason]=useState(''),[decision,setDecision]=useState<'accepted'|'rejected'>('rejected'),[compared,setCompared]=useState(false),[pending,setPending]=useState<ReviewRequest|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 const alive=useRef(true),lock=useRef(false),c=candidate.citation.context,url=`/api/cases/${c.caseId}/integrity-jobs/${c.jobId}/document-citations/${candidate.id}/reviews`;
 async function read(signal?:AbortSignal){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});const data=await r.json();if(!r.ok)throw new Error(data.error||'Review unavailable.');return verifyReviewHistory(data,candidate);}
 useEffect(()=>{alive.current=true;const controller=new AbortController();void read(controller.signal).then(h=>{if(!controller.signal.aborted)setHistory(h);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>{alive.current=false;controller.abort();};},[]);
 async function act(save:boolean){if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   let h:ReviewHistory;
   if(save){
    if(!history&&!pending)throw new Error('Refresh review history first.');
    const input=pending??{id:crypto.randomUUID(),previousReviewId:history!.currentReviewId,citationDigest:candidate.citationDigest,decision,reason,originalCompared:compared};setPending(input);
    const r=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(input)});const data=await r.json();
    if(!r.ok){if(r.status>=400&&r.status<500&&alive.current)setPending(null);throw new Error(data.error||'Review response unconfirmed. Recover before another decision.');}
    h=await verifyReviewHistory(data,candidate);const confirmed=h.reviews.find(r=>r.id===input.id);
    if(!confirmed||(['previousReviewId','citationDigest','decision','reason','originalCompared'] as const).some(k=>confirmed[k]!==input[k]))throw new Error('Review receipt does not match the submitted decision.');
    if(alive.current){setPending(null);setReason('');setCompared(false);}
   }else{h=await read();if(pending&&h.reviews.some(r=>r.id===pending.id)&&alive.current)setPending(null);}
   if(alive.current)setHistory(h);
  }catch(e){if(alive.current){setHistory(null);setError((e as Error).message);}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 const current=history?.reviews.at(-1);
 return <section aria-label="Citation correspondence review"><h4>Review exact source correspondence</h4>
  <p>Candidate {candidate.id} · page {candidate.citation.page} · {candidate.citation.itemRef}. A different reviewer must compare the original. Acceptance concerns this extraction only; it does not establish truth or approve a finding.</p>
  <p role="status">{busy?'Verifying review history…':current?`Current correspondence decision: ${current.decision} · revision ${current.sequence}`:history?'No human correspondence decision recorded.':''}</p>
  {error&&<p role="alert">{error}</p>}
  <button className="secondary" disabled={busy} onClick={()=>void act(false)}>Refresh review history</button>
  <ol>{history?.reviews.map(r=><li key={r.id}>Revision {r.sequence}: {r.decision} · {r.reviewedAt} · reviewer {r.reviewedBy}<p>{r.reason}</p><p>Review SHA-256: {r.digest}</p></li>)}</ol>
  <form onSubmit={e=>{e.preventDefault();void act(true);}}>
   <label>Correspondence decision<select disabled={busy||!!pending} value={decision} onChange={e=>setDecision(e.target.value as 'accepted'|'rejected')}><option value="rejected">Reject correspondence</option><option value="accepted">Accept correspondence</option></select></label>
   <label>Review reason<textarea required maxLength={4096} disabled={busy||!!pending} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <label><input type="checkbox" disabled={busy||!!pending} checked={compared} onChange={e=>setCompared(e.target.checked)}/>I compared this exact passage and region with the original source.</label>
   <button className="primary" disabled={busy||(!pending&&(!history||!reason.trim()||decision==='accepted'&&!compared))}>{pending?'Recover pending review':current?'Record replacement decision':'Record correspondence decision'}</button>
   <p>Replacement decisions retain all earlier decisions. Unconfirmed submissions can be recovered in this view; after reload, refresh history before submitting again.</p>
  </form>
  {history&&<DocumentClaims key={history.currentReviewId??'none'} candidate={candidate} reviews={history} csrf={csrf}/>}
 </section>;
}
