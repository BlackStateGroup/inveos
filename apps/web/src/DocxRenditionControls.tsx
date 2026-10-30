import {reportRecoveryScope} from './reportRecovery';
import {useEffect,useRef,useState} from 'react';

type Review={id:string;renditionId:string;docxSha256:string;redactionSha256:string;reviewerId:string;decision:string;reason:string;createdAt:string;status:string};
type Release={docxSha256:string;recipientId:string;idempotencyKey:string;expiresAt:string;reason:string;confirmReviewedDisclosure:true};
export function DocxRenditionControls({caseId,revisionId,renditionId,docxSha256,redactionSha256,csrf,verified,onDenied}:{caseId:string;revisionId:string;renditionId:string;docxSha256:string;redactionSha256:string;csrf:string;verified:boolean;onDenied:()=>void}){
 const base=`/api/cases/${caseId}/report-revisions/${revisionId}/editable-renditions/${renditionId}`;
 const [key,setKey]=useState<string|null>(null);useEffect(()=>{let live=true;void reportRecoveryScope(csrf,caseId).then(scope=>{if(live){const next=scope+':docx-release:'+renditionId;setKey(next);setPending(Boolean(sessionStorage.getItem(next)));}}).catch(()=>{if(live)setError('Reconnect before releasing a saved DOCX.');});return()=>{live=false;};},[csrf,caseId,renditionId]);
 const [reviews,setReviews]=useState<Review[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
 const controller=useRef<AbortController|null>(null);useEffect(()=>()=>controller.current?.abort(),[]);
 async function request(path:string,signal:AbortSignal,payload?:object){
  const response=await fetch(base+path,{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),credentials:'same-origin',cache:'no-store',method:payload?'POST':'GET',...(payload?{headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(payload)}:{})});
  const value=await response.json();if(!response.ok){if([401,403,404].includes(response.status)){if(key)sessionStorage.removeItem(key);setPending(false);onDenied();}throw Object.assign(new Error(value.error||'DOCX request failed.'),{status:response.status});}return value;
 }
 async function run(work:(signal:AbortSignal)=>Promise<void>){controller.current?.abort();const current=new AbortController();controller.current=current;setBusy(true);setError('');setMessage('');try{await work(current.signal);}catch(e){if(!current.signal.aborted){setReviews([]);setError(e instanceof Error?e.message:'DOCX request failed.');}}finally{if(!current.signal.aborted)setBusy(false);}}
 function checked(review:Review){if(review.renditionId!==renditionId||review.docxSha256!==docxSha256||review.redactionSha256!==redactionSha256||review.status!=='rendition_review_not_release')throw new Error('DOCX review receipt mismatch.');return review;}
 async function load(signal:AbortSignal){const page=await request('/reviews',signal);if(!Array.isArray(page.items)||page.items.length>50)throw new Error('DOCX review history is invalid.');const items=page.items.map(checked);if(!signal.aborted){setReviews(items);setMessage(items.length?'DOCX review decisions loaded.':'No DOCX review decisions recorded.');}}
 async function review(data:FormData,signal:AbortSignal){const item=checked(await request('/reviews',signal,{docxSha256,redactionSha256,decision:String(data.get('decision')),reason:String(data.get('reason')),confirmInspected:true}));if(!signal.aborted){setReviews([item]);setMessage('Independent DOCX review recorded. This decision does not create a disclosure.');}}
 async function release(signal:AbortSignal,data?:FormData){
  if(!key)throw new Error('Reconnect before releasing a saved DOCX.');
  const raw=sessionStorage.getItem(key),input:Release=raw?JSON.parse(raw):{docxSha256,recipientId:String(data?.get('recipientId')),idempotencyKey:crypto.randomUUID(),expiresAt:String(data?.get('expiresAt')),reason:String(data?.get('reason')),confirmReviewedDisclosure:true};
  if(input.docxSha256!==docxSha256||input.confirmReviewedDisclosure!==true)throw new Error('Pending DOCX release does not match this rendition.');
  sessionStorage.setItem(key,JSON.stringify(input));setPending(true);
  let receipt;try{receipt=await request('/disclosures',signal,input);}catch(error){if([400,422].includes((error as {status?:number}).status??0)){sessionStorage.removeItem(key);setPending(false);}throw error;}
  if(receipt.caseId!==caseId||receipt.revisionId!==revisionId||receipt.renditionId!==renditionId||receipt.sha256!==docxSha256||receipt.recipientId!==input.recipientId||receipt.deliverable!=='report_docx'||receipt.status!=='recipient_disclosure_grant')throw new Error('DOCX disclosure receipt mismatch.');
  sessionStorage.removeItem(key);if(!signal.aborted){setPending(false);setMessage('Restricted DOCX release confirmed. The recipient can download the exact reviewed DOCX. Edits made after downloading change its fingerprint and have no approval.');}
 }
 return <div>
  <p style={{overflowWrap:'anywhere'}}>Redaction SHA-256: {redactionSha256}</p>
  {error&&<p role="alert">{error} Inspect recorded decisions or recover the pending release before retrying.</p>}<p role="status">{busy?'Working…':message}</p>
  <button className="secondary" disabled={busy||!key} onClick={()=>void run(load)}>Inspect DOCX reviews {renditionId.slice(0,8)}</button>
  {reviews.map(item=><p key={item.id}>{item.decision} · {item.reviewerId} · {item.createdAt}: {item.reason}</p>)}
  <details><summary>Independently review this DOCX</summary><p>A different assigned reviewer must inspect the downloaded DOCX, redactions, scope and privilege before accepting it for disclosure. The report author and DOCX creator cannot self-review.</p>
   <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(signal=>review(data,signal));}}><fieldset disabled={busy||!verified||!key}>
    <label className="form-label">DOCX review decision<select name="decision"><option value="request_changes">Request changes</option><option value="accept_for_disclosure">Accept for disclosure</option></select></label>
    <label className="form-label">DOCX review reason<textarea name="reason" required minLength={10} maxLength={2000}/></label>
    <label><input type="checkbox" required/> I inspected the exact DOCX, all retained content and the redactions for scope and privilege. This decision records my assessment.</label><button className="secondary">Record DOCX review</button>
   </fieldset></form><p>Download and verify this saved DOCX to enable review.</p></details>
  <details><summary>Release this reviewed DOCX</summary><p>Explicitly disclose only this exact DOCX to one client for up to seven days. Original exhibits and the unredacted report are not attached. A current independent acceptance and no change requests are required.</p>
   {pending&&<button className="secondary" disabled={busy||!key} onClick={()=>void run(signal=>release(signal))}>Recover pending DOCX release</button>}
   <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(signal=>release(signal,data));}}><fieldset disabled={busy||pending||!verified||!key}>
    <label className="form-label">DOCX recipient UUID<input name="recipientId" required pattern="[a-fA-F0-9-]{36}"/></label>
    <label className="form-label">DOCX release expiry UTC<input name="expiresAt" required placeholder="2026-10-30T12:00:00Z"/></label>
    <label className="form-label">DOCX disclosure reason<textarea name="reason" required minLength={10} maxLength={2000}/></label>
    <label><input type="checkbox" required/> I approve this recipient receiving the exact reviewed DOCX, including all retained case context and limitations.</label><button className="secondary">Approve DOCX disclosure</button>
   </fieldset></form></details>
 </div>;
}
