import {useEffect,useRef,useState} from 'react';

type Review={id:string;renditionId:string;pdfSha256:string;redactionSha256:string;reviewerId:string;decision:string;reason:string;createdAt:string;status:string};
type Release={pdfSha256:string;recipientId:string;idempotencyKey:string;expiresAt:string;reason:string;confirmReviewedDisclosure:true};
export function PdfRenditionControls({caseId,revisionId,renditionId,pdfSha256,redactionSha256,csrf,verified}:{caseId:string;revisionId:string;renditionId:string;pdfSha256:string;redactionSha256:string;csrf:string;verified:boolean}){
 const base=`/api/cases/${caseId}/report-revisions/${revisionId}/renditions/${renditionId}`,key=`inveos:pdf-release:v1:${caseId}:${renditionId}`;
 const [reviews,setReviews]=useState<Review[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(()=>Boolean(sessionStorage.getItem(key)));
 const controller=useRef<AbortController|null>(null);useEffect(()=>()=>controller.current?.abort(),[]);
 async function request(path:string,signal:AbortSignal,payload?:object){
  const response=await fetch(base+path,{signal,credentials:'same-origin',cache:'no-store',method:payload?'POST':'GET',...(payload?{headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(payload)}:{})});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'PDF request failed.');return value;
 }
 async function run(work:(signal:AbortSignal)=>Promise<void>){controller.current?.abort();const current=new AbortController();controller.current=current;setBusy(true);setError('');setMessage('');try{await work(current.signal);}catch(e){if(!current.signal.aborted){setReviews([]);setError(e instanceof Error?e.message:'PDF request failed.');}}finally{if(!current.signal.aborted)setBusy(false);}}
 function checked(review:Review){if(review.renditionId!==renditionId||review.pdfSha256!==pdfSha256||review.redactionSha256!==redactionSha256||review.status!=='rendition_review_not_release')throw new Error('PDF review receipt mismatch.');return review;}
 async function load(signal:AbortSignal){const page=await request('/reviews',signal);if(!Array.isArray(page.items)||page.items.length>50)throw new Error('PDF review history is invalid.');const items=page.items.map(checked);if(!signal.aborted){setReviews(items);setMessage(items.length?'PDF review decisions loaded.':'No PDF review decisions recorded.');}}
 async function review(data:FormData,signal:AbortSignal){const item=checked(await request('/reviews',signal,{pdfSha256,redactionSha256,decision:String(data.get('decision')),reason:String(data.get('reason')),confirmInspected:true}));if(!signal.aborted){setReviews([item]);setMessage('Independent PDF review recorded. This decision does not create a disclosure.');}}
 async function release(signal:AbortSignal,data?:FormData){
  const raw=sessionStorage.getItem(key),input:Release=raw?JSON.parse(raw):{pdfSha256,recipientId:String(data?.get('recipientId')),idempotencyKey:crypto.randomUUID(),expiresAt:String(data?.get('expiresAt')),reason:String(data?.get('reason')),confirmReviewedDisclosure:true};
  if(input.pdfSha256!==pdfSha256||input.confirmReviewedDisclosure!==true)throw new Error('Pending PDF release does not match this rendition.');
  sessionStorage.setItem(key,JSON.stringify(input));setPending(true);
  const receipt=await request('/disclosures',signal,input);
  if(receipt.caseId!==caseId||receipt.revisionId!==revisionId||receipt.renditionId!==renditionId||receipt.sha256!==pdfSha256||receipt.recipientId!==input.recipientId||receipt.deliverable!=='report_pdf'||receipt.status!=='recipient_disclosure_grant')throw new Error('PDF disclosure receipt mismatch.');
  sessionStorage.removeItem(key);if(!signal.aborted){setPending(false);setMessage('Restricted PDF release confirmed. The client can download only the reviewed PDF; original exhibits and report JSON are not included.');}
 }
 return <div>
  <p style={{overflowWrap:'anywhere'}}>Redaction SHA-256: {redactionSha256}</p>
  {error&&<p role="alert">{error} Inspect recorded decisions or recover the pending release before retrying.</p>}<p role="status">{busy?'Working…':message}</p>
  <button className="secondary" disabled={busy} onClick={()=>void run(load)}>Inspect PDF reviews {renditionId.slice(0,8)}</button>
  {reviews.map(item=><p key={item.id}>{item.decision} · {item.reviewerId} · {item.createdAt}: {item.reason}</p>)}
  <details><summary>Independently review this PDF</summary><p>A different assigned reviewer must inspect the downloaded PDF, redactions, scope and privilege before accepting it for disclosure. The report author and PDF creator cannot self-review.</p>
   <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(signal=>review(data,signal));}}><fieldset disabled={busy||!verified}>
    <label className="form-label">PDF review decision<select name="decision"><option value="request_changes">Request changes</option><option value="accept_for_disclosure">Accept for disclosure</option></select></label>
    <label className="form-label">PDF review reason<textarea name="reason" required minLength={10} maxLength={2000}/></label>
    <label><input type="checkbox" required/> I inspected the exact PDF, all retained content and the redactions for scope and privilege. This decision records my assessment.</label><button className="secondary">Record PDF review</button>
   </fieldset></form><p>Download and verify this saved PDF to enable review.</p></details>
  <details><summary>Release this reviewed PDF</summary><p>Explicitly disclose only this exact PDF to one client for up to seven days. Original exhibits and the unredacted report are not attached. A current independent acceptance and no change requests are required.</p>
   {pending&&<button className="secondary" disabled={busy} onClick={()=>void run(signal=>release(signal))}>Recover pending PDF release</button>}
   <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(signal=>release(signal,data));}}><fieldset disabled={busy||pending||!verified}>
    <label className="form-label">PDF recipient UUID<input name="recipientId" required pattern="[a-fA-F0-9-]{36}"/></label>
    <label className="form-label">PDF release expiry UTC<input name="expiresAt" required placeholder="2026-10-30T12:00:00Z"/></label>
    <label className="form-label">PDF disclosure reason<textarea name="reason" required minLength={10} maxLength={2000}/></label>
    <label><input type="checkbox" required/> I approve this recipient receiving the exact reviewed PDF, including all retained case context and limitations.</label><button className="secondary">Approve PDF disclosure</button>
   </fieldset></form></details>
 </div>;
}
