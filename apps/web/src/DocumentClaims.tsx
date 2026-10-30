import {useEffect,useRef,useState} from 'react';
import type {CitationReceipt} from './citationRequest';
import type {ReviewHistory} from './citationReview';
import {verifyDocumentClaims,type DocumentClaimDecisionRequest,type DocumentClaimRequest,type DocumentClaimWorkspace} from './documentClaims';

export function DocumentClaims({candidate,reviews,csrf}:{candidate:CitationReceipt;reviews:ReviewHistory;csrf:string}){
 const [workspace,setWorkspace]=useState<DocumentClaimWorkspace|null>(null),[text,setText]=useState(''),[selected,setSelected]=useState<string|null>(null),[accepted,setAccepted]=useState(false),[reason,setReason]=useState('');
 const [pendingClaim,setPendingClaim]=useState<DocumentClaimRequest|null>(null),[pendingDecision,setPendingDecision]=useState<(DocumentClaimDecisionRequest&{claimId:string})|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const alive=useRef(true),lock=useRef(false),c=candidate.citation.context,base=`/api/cases/${c.caseId}/integrity-jobs/${c.jobId}/document-citations/${candidate.id}/claims`;
 async function decode(r:Response){const data=await r.json();if(!r.ok)throw new Error(data.error||'Document-derived claims unavailable.');return data;}
 async function load(signal?:AbortSignal){const data=await decode(await fetch(base,{credentials:'same-origin',cache:'no-store',signal}));return verifyDocumentClaims(data,candidate,reviews);}
 useEffect(()=>{alive.current=true;const controller=new AbortController();void load(controller.signal).then(w=>{if(!controller.signal.aborted)setWorkspace(w);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>{alive.current=false;controller.abort();};},[reviews.currentReviewId]);
 async function act(operation:()=>Promise<DocumentClaimWorkspace>,retainForRecovery=false){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const w=await operation();if(alive.current)setWorkspace(w);}catch(e){if(alive.current){if(!retainForRecovery)setWorkspace(null);setError((e as Error).message);}}finally{lock.current=false;if(alive.current)setBusy(false);}}
 async function propose(){return act(async()=>{
  const current=reviews.reviews.at(-1);if(!current||current.decision!=='accepted')throw new Error('The current correspondence decision must be accepted first.');
  const input=pendingClaim??{id:crypto.randomUUID(),citationDigest:candidate.citationDigest,correspondenceReviewId:current.id,correspondenceReviewDigest:current.digest,text};setPendingClaim(input);
  const data=await decode(await fetch(base,{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(input)}));const w=await verifyDocumentClaims(data,candidate,reviews),saved=w.claims.find(c=>c.id===input.id);
  if(!saved||saved.text!==input.text||saved.correspondenceReviewDigest!==input.correspondenceReviewDigest)throw new Error('Claim receipt does not match the proposed interpretation.');if(alive.current){setPendingClaim(null);setText('');}return w;
 },true);}
 async function decide(){return act(async()=>{
  const claim=workspace?.claims.find(x=>x.id===(pendingDecision?.claimId??selected));if(!claim)throw new Error('Select a verified claim.');
  const input=pendingDecision??{claimId:claim.id,id:crypto.randomUUID(),claimDigest:claim.digest,accepted,reason};setPendingDecision(input);
  const data=await decode(await fetch(`${base}/${claim.id}/decision`,{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({id:input.id,claimDigest:input.claimDigest,accepted:input.accepted,reason:input.reason})}));
  if(data.claimId!==claim.id||data.decision?.id!==input.id||data.decision?.claimDigest!==input.claimDigest||data.decision?.accepted!==input.accepted||data.decision?.reason!==input.reason)throw new Error('Claim decision receipt could not be confirmed.');
  const w=await load();if(alive.current){setPendingDecision(null);setReason('');setSelected(null);}return w;
 },true);}
 const current=reviews.reviews.at(-1),selectedClaim=workspace?.claims.find(c=>c.id===(pendingDecision?.claimId??selected));
 return <section aria-label="Document-derived claims"><h4>Document-derived claims and findings</h4>
  <p>Claim text is an investigator interpretation. Accepted source correspondence supports review; it does not make the interpretation true. A separate reviewer decision is required for a finding.</p>
  {error&&<p role="alert">{error}</p>}<p role="status">{busy?'Verifying document-derived claims…':workspace&&!workspace.claims.length?'No document-derived claims recorded.':''}</p>
  <button className="secondary" disabled={busy} onClick={()=>void act(()=>load())}>Refresh document-derived claims</button>
  <form className="work-form document-review-form" onSubmit={e=>{e.preventDefault();void propose();}}><label className="form-label">Proposed interpretation<textarea required maxLength={8000} disabled={busy||!!pendingClaim||current?.decision!=='accepted'} value={pendingClaim?.text??text} onChange={e=>setText(e.target.value)}/></label>
   <div className="work-form-actions"><button className="primary" disabled={busy||(!pendingClaim&&(current?.decision!=='accepted'||!text.trim()))}>{pendingClaim?'Recover pending claim':'Propose document-derived claim'}</button></div>
  </form>
  <ol>{workspace?.claims.map(claim=><li key={claim.id}><strong>{claim.finding?'Accepted document finding':claim.decision?.accepted===false?'Rejected interpretation':'Proposed interpretation'}</strong><p>{claim.text}</p><p>Claim {claim.id} · SHA-256 {claim.digest} · correspondence {claim.correspondenceCurrent?'current':'superseded'}</p>{claim.decision&&<p>Decision: {claim.decision.accepted?'accepted':'rejected'} · {claim.decision.reason} · SHA-256 {claim.decision.digest}</p>}{!claim.decision&&<button className="secondary" disabled={busy} onClick={()=>setSelected(claim.id)}>Review interpretation {claim.id.slice(0,8)}</button>}</li>)}</ol>
  {selectedClaim&&!selectedClaim.decision&&<form className="work-form document-review-form" onSubmit={e=>{e.preventDefault();void decide();}} aria-label="Document claim decision"><p>Reviewing claim {selectedClaim.id}. Verify the interpretation separately from the source correspondence.</p><label className="checkbox-row"><input type="checkbox" disabled={busy||!!pendingDecision} checked={pendingDecision?.accepted??accepted} onChange={e=>setAccepted(e.target.checked)}/><span>Accept this interpretation as a finding</span></label><label className="form-label">Decision reason<textarea required maxLength={6000} disabled={busy||!!pendingDecision} value={pendingDecision?.reason??reason} onChange={e=>setReason(e.target.value)}/></label><div className="work-form-actions"><button className="primary" disabled={busy||(!pendingDecision&&!reason.trim())}>{pendingDecision?'Recover pending claim decision':'Record claim decision'}</button></div></form>}
 </section>;
}
