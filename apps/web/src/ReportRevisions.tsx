import {CasePortalFeedback} from './PortalFeedback';
import {ReportRedactionChoices} from './ReportRedactionChoices';
import {EditableReports} from './EditableReports';
import {useEffect, useRef, useState} from 'react';
import {verifyRevisionDownload} from './reportDownload';
import {readDocumentPackageBytes,readVerifiedDocumentPackage,saveVerifiedDocumentPackage,verifyDocumentPackageDownload} from './documentPackageDownload';
import {pendingReportFreeze, recoverableReportFreeze, reportRecoveryScope} from './reportRecovery';
import {Panel, Notice} from './ui';
import {DisclosureHistory} from './DisclosureHistory';
import {readReportPdfBytes,verifyReportPdfDownload} from './reportPdfDownload';
import {ReportRenditionHistory} from './ReportRenditionHistory';

type Receipt={id:string;caseId:string;status:string;sha256:string;createdAt:string};
type Page={items:Receipt[];nextBefore:string|null};
type RenditionReceipt={id:string;caseId:string;revisionId:string;status:string;format:'pdf';sourceReportSha256:string;pdfSha256:string;profileDigest:string;redactionSha256:string;redactedFindingCount:number;createdAt:string};
type RenditionPayload={idempotencyKey:string;redactedFindingIds:string[];reason?:string};
type ReleasePayload={sha256:string;recipientId:string;idempotencyKey:string;expiresAt:string;reason:string;confirmFullDisclosure:true;documentPackageSha256?:string;confirmDocumentPackageVerified?:true};
const releaseKey=(caseId:string,revisionId:string)=>`inveos:report-release:v1:${caseId}:${revisionId}`;
const renditionKey=(caseId:string,revisionId:string)=>`inveos:report-rendition:v1:${caseId}:${revisionId}`;
function pendingRendition(store:Pick<Storage,'getItem'>,caseId:string,revisionId:string):RenditionPayload|null{try{const value=JSON.parse(store.getItem(renditionKey(caseId,revisionId))||'null') as RenditionPayload|null;return value&&typeof value.idempotencyKey==='string'&&Array.isArray(value.redactedFindingIds)?value:null;}catch{return null;}}
function pendingRelease(store:Pick<Storage,'getItem'>,caseId:string,row:Receipt):ReleasePayload|null{try{const raw=store.getItem(releaseKey(caseId,row.id));if(!raw)return null;const value=JSON.parse(raw) as ReleasePayload;return value.sha256===row.sha256&&typeof value.recipientId==='string'&&typeof value.idempotencyKey==='string'?value:null;}catch{return null;}}
async function json<T>(url:string,signal?:AbortSignal,body?:object,csrf?:string):Promise<T>{
  const response=await fetch(url,{signal,credentials:'same-origin',method:body?'POST':'GET',
    headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf||''}:{},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Report request failed.');return result;
}
export function ReportRevisions({caseId,csrf,focusRevisionId,focusCopyId}:{caseId:string;csrf:string;focusRevisionId?:string;focusCopyId?:string}){
  const [rows,setRows]=useState<Receipt[]>([]),[next,setNext]=useState<string|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [pending,setPending]=useState(false);
  const [reviewHistory,setReviewHistory]=useState<Record<string,Array<{id:string;decision:string;reason:string;reviewerId:string;createdAt:string}>>>({});
  const [verified,setVerified]=useState<Record<string,boolean>>({});
  const [verifiedPackages,setVerifiedPackages]=useState<Record<string,string>>({});
  const [pendingReleases,setPendingReleases]=useState<Record<string,boolean>>({});
  const [pendingRenditions,setPendingRenditions]=useState<Record<string,boolean>>({});
  const inFlight=useRef(false),alive=useRef(true),focusedOnce=useRef('');
  const base=`/api/cases/${caseId}/report-revisions`;
  useEffect(()=>{
    alive.current=true;const controller=new AbortController();
    void Promise.all([json<Page>(base,controller.signal),reportRecoveryScope(csrf,caseId),focusRevisionId?json<Receipt>(base+'/'+focusRevisionId+'/receipt',controller.signal):Promise.resolve(null)]).then(([page,scope,focused])=>{
      if(controller.signal.aborted)return;
      setRows(focused?[focused,...page.items.filter(row=>row.id!==focused.id)]:page.items);setNext(page.nextBefore);setPending(!!pendingReportFreeze(window.sessionStorage,scope));
      setVerifiedPackages(Object.fromEntries(page.items.flatMap(row=>{const saved=readVerifiedDocumentPackage(window.sessionStorage,caseId,row.id,row.sha256);return saved?[[row.id,saved.packageSha256]]:[];})));
      setPendingReleases(Object.fromEntries(page.items.filter(row=>pendingRelease(window.sessionStorage,caseId,row)).map(row=>[row.id,true])));
      setPendingRenditions(Object.fromEntries(page.items.filter(row=>pendingRendition(window.sessionStorage,caseId,row.id)).map(row=>[row.id,true])));
    })
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>{alive.current=false;controller.abort();};
  },[base,csrf,caseId,focusRevisionId]);
  useEffect(()=>{if(focusRevisionId&&focusedOnce.current!==focusRevisionId&&!busy&&rows.some(row=>row.id===focusRevisionId)){focusedOnce.current=focusRevisionId;const target=document.getElementById('report-revision-'+focusRevisionId);target?.focus();target?.scrollIntoView({block:'start'});}},[focusRevisionId,busy,rows]);
  async function act(operation:()=>Promise<void>){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setMessage('');
    try{await operation();}catch(e){if(alive.current)setError((e as Error).message);}finally{inFlight.current=false;if(alive.current)setBusy(false);}
  }
  async function load(older=false){
    const page=await json<Page>(`${base}${older&&next?`?before=${encodeURIComponent(next)}`:''}`);
    if(!alive.current)return;setRows(old=>older?[...old,...page.items.filter(row=>!old.some(x=>x.id===row.id))]:page.items);setNext(page.nextBefore);
  }
  async function freeze(){
    const scope=await reportRecoveryScope(csrf,caseId);
    const store=window.sessionStorage;
    let receipt:Receipt;
    try {
      receipt=await recoverableReportFreeze(store,scope,caseId,key=>json<Receipt>(base,AbortSignal.timeout(30000),{idempotencyKey:key},csrf));
    } finally {
      if(alive.current)setPending(!!pendingReportFreeze(store,scope));
    }
    if(!alive.current)return;
    setRows(old=>[receipt,...old.filter(row=>row.id!==receipt.id)]);
    setMessage('Internal revision saved. Download it below and retain its fingerprint separately.');
  }
  async function download(row:Receipt){
    const response=await fetch(`${base}/${row.id}`,{credentials:'same-origin'});
    if(!response.ok){const body=await response.json();throw new Error(body.error||'Download failed.');}
    const bytes=await response.arrayBuffer();
    await verifyRevisionDownload(bytes,row.sha256,response.headers.get('X-INVEOS-Report-SHA256'));
    if(!alive.current)return;
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`inveos-report-${row.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setVerified(old=>({...old,[row.id]:true}));
    setMessage('Exact revision bytes verified and downloaded. This remains an internal draft.');
  }
  async function verifySources(row:Receipt){
    const receipt=await json<{revisionId:string;caseId:string;sha256:string;findingCount:number;status:string}>(`${base}/${row.id}/verify-sources`,AbortSignal.timeout(30000),{sha256:row.sha256},csrf);
    if(receipt.revisionId!==row.id||receipt.caseId!==caseId||receipt.sha256!==row.sha256||receipt.status!=='snapshot_sources_verified_not_released')throw new Error('Source verification receipt mismatch.');
    if(alive.current)setMessage(`${receipt.findingCount} frozen findings matched current stored source bytes and review links. This point-in-time check is not approval or release.`);
  }
  async function documentPackage(row:Receipt){
    const response=await fetch(`${base}/${row.id}/document-package`,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'Document package download failed.');}
    const bytes=await readDocumentPackageBytes(response),checked=await verifyDocumentPackageDownload(bytes,row.sha256,response.headers.get('X-INVEOS-Package-SHA256'));
    const receipt={caseId,revisionId:row.id,reportSha256:row.sha256,packageSha256:checked.packageSha256,verifiedAt:new Date().toISOString()};
    saveVerifiedDocumentPackage(window.sessionStorage,receipt);if(!alive.current)return;
    setVerifiedPackages(old=>({...old,[row.id]:checked.packageSha256}));const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`document-report-${row.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setMessage(`Verified and downloaded a ${checked.documentFindings}-finding document package. Retain its package and report fingerprints separately.`);
  }
  async function rendition(row:Receipt,data?:FormData){
    const store=window.sessionStorage,previous=pendingRendition(store,caseId,row.id),ids=String(data?.get('findingIds')??'').split(/[\s,]+/).map(v=>v.trim()).filter(Boolean);
    if(data&&!ids.length)throw new Error('Select at least one frozen finding to redact.');
    const payload:RenditionPayload=previous??{idempotencyKey:crypto.randomUUID(),redactedFindingIds:ids,...(ids.length?{reason:String(data?.get('reason')??'')}: {})};store.setItem(renditionKey(caseId,row.id),JSON.stringify(payload));setPendingRenditions(old=>({...old,[row.id]:true}));
    const receipt=await json<RenditionReceipt>(`${base}/${row.id}/renditions`,AbortSignal.timeout(30000),payload,csrf);if(receipt.caseId!==caseId||receipt.revisionId!==row.id||receipt.sourceReportSha256!==row.sha256||receipt.status!=='internal_rendition_not_released'||receipt.format!=='pdf')throw new Error('PDF rendition receipt mismatch.');
    const response=await fetch(`${base}/${row.id}/renditions/${receipt.id}`,{credentials:'same-origin',cache:'no-store'});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'PDF rendition download failed.');}const bytes=await readReportPdfBytes(response);await verifyReportPdfDownload(bytes,receipt.pdfSha256,row.sha256,response.headers.get('X-INVEOS-PDF-SHA256'),response.headers.get('X-INVEOS-Report-SHA256'));
    store.removeItem(renditionKey(caseId,row.id));setPendingRenditions(old=>({...old,[row.id]:false}));const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),link=document.createElement('a');link.href=url;link.download=`internal-report-${receipt.id}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);if(alive.current)setMessage(`${receipt.redactedFindingCount?'Redacted':'Unredacted'} PDF bytes verified and downloaded. Run tools/verify_report_pdf.py for independent semantic-stream verification. This is not a client release.`);
  }
  async function release(row:Receipt,data?:FormData){
    if(!verified[row.id]&&!verifiedPackages[row.id])throw new Error('Verify the exact report or document package before creating a release.');
    const store=window.sessionStorage,previous=pendingRelease(store,caseId,row),packageSha256=verifiedPackages[row.id];
    const payload:ReleasePayload=previous??{sha256:row.sha256,recipientId:String(data?.get('recipientId')),idempotencyKey:crypto.randomUUID(),expiresAt:String(data?.get('expiresAt')),reason:String(data?.get('reason')),confirmFullDisclosure:true,...(packageSha256?{documentPackageSha256:packageSha256,confirmDocumentPackageVerified:true as const}: {})};
    if(payload.documentPackageSha256!==packageSha256)throw new Error('The pending release was prepared for a different package fingerprint. Clear the tab session and verify the package again.');
    store.setItem(releaseKey(caseId,row.id),JSON.stringify(payload));setPendingReleases(old=>({...old,[row.id]:true}));
    const receipt=await json<{id:string;caseId:string;revisionId:string;recipientId:string;sha256:string;reportSha256:string;deliverable:string;status:string}>(`${base}/${row.id}/disclosures`,AbortSignal.timeout(30000),payload,csrf);
    if(receipt.caseId!==caseId||receipt.revisionId!==row.id||receipt.recipientId!==payload.recipientId||receipt.reportSha256!==row.sha256||receipt.sha256!==(packageSha256??row.sha256)||receipt.deliverable!==(packageSha256?'document_package':'report_json')||receipt.status!=='recipient_disclosure_grant')throw new Error('Release receipt did not match the verified deliverable.');
    store.removeItem(releaseKey(caseId,row.id));setPendingReleases(old=>({...old,[row.id]:false}));
    if(alive.current)setMessage(`Restricted ${receipt.deliverable==='document_package'?'document package':'report'} release created. The recipient can retrieve only this frozen deliverable until expiry or revocation.`);
  }
  async function reviews(row:Receipt){
    const result=await json<{items:Array<{id:string;decision:string;reason:string;reviewerId:string;createdAt:string}>}>(`${base}/${row.id}/reviews`);
    if(alive.current)setReviewHistory(old=>({...old,[row.id]:result.items}));
  }
  async function review(row:Receipt,data:FormData){
    if(!verified[row.id])throw new Error('Download and verify this frozen revision before recording your review.');
    await json(`${base}/${row.id}/reviews`,AbortSignal.timeout(30000),{sha256:row.sha256,decision:String(data.get('decision')),reason:String(data.get('reason'))},csrf);
    if(alive.current)setMessage('Internal review recorded. This does not authorise client release.');
    await reviews(row);
  }
  return <><DisclosureHistory key={`${caseId}:${csrf}`} caseId={caseId} csrf={csrf}/><CasePortalFeedback key={`${caseId}:feedback:${csrf}`} caseId={caseId} csrf={csrf}/><Panel title="Saved internal report revisions"><div className="panel-body">
    {focusRevisionId&&<Notice>Opened review context for revision {focusRevisionId}.{focusCopyId?' Inspect saved copy '+focusCopyId+' under its PDF or DOCX controls.':''} Verify and inspect the exact download before recording a decision.</Notice>}<Notice>Freeze reviewed findings and working context at a point in time. Saved revisions do not change with the case and are not client releases.</Notice>
    <div className="report-export-actions"><button className="primary" disabled={busy} onClick={()=>void act(freeze)}>{pending?'Recover pending freeze':'Freeze current internal draft'}</button>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>load())}>Refresh revisions</button></div>
    {pending&&<p role="status">A previous freeze has no confirmed receipt. Recover it before starting another revision.</p>}
    <p className="small muted">Retry recovery lasts for this tab and sign-in. After signing out or closing the tab, check saved revisions before freezing again.</p>
    {error&&<p className="form-error" role="alert">{error} Retry the action when ready.</p>}
    <p role="status">{busy?'Loading report revisions…':message||(!rows.length?'No saved revisions yet.':'')}</p>
    <ul>{rows.map(row=><li key={row.id} id={'report-revision-'+row.id} tabIndex={-1}>
      <p><strong>Internal draft · {new Date(row.createdAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</strong></p>
      <label className="form-label">SHA-256 for revision {row.id}<input readOnly value={row.sha256}/></label>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>download(row))}>Download revision {row.id.slice(0,8)}</button>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>documentPackage(row))}>Verify and download document package {row.id.slice(0,8)}</button>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>rendition(row))}>Create unredacted PDF {row.id.slice(0,8)}</button>
      <EditableReports key={`docx:${caseId}:${row.id}:${csrf}`} caseId={caseId} revisionId={row.id} reportSha256={row.sha256} csrf={csrf}/>
      <ReportRenditionHistory key={`${caseId}:${row.id}`} caseId={caseId} revisionId={row.id} reportSha256={row.sha256} csrf={csrf}/>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>verifySources(row))}>Reverify cited originals</button>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>reviews(row))}>Inspect review decisions</button>
      {verifiedPackages[row.id]&&<label className="form-label">Verified package SHA-256<input aria-label={`Verified package SHA-256 ${row.id}`} readOnly value={verifiedPackages[row.id]}/></label>}
      {reviewHistory[row.id]?.map(item=><p key={item.id}>{item.decision} · reviewer {item.reviewerId} · {item.createdAt}: {item.reason}</p>)}
      <details><summary>Create an internal redacted PDF</summary><p>Select whole findings from this frozen revision. Redacted findings and their source metadata are omitted from both visible PDF streams and the embedded semantic model. This narrow profile rejects unsupported Unicode; it does not release the result.</p>
        {pendingRenditions[row.id]&&<><p role="status">A rendition request has no confirmed receipt. Recover it with the saved request identity before starting another.</p><button className="secondary" disabled={busy} onClick={()=>void act(()=>rendition(row))}>Recover pending PDF rendition</button></>}
        <form className="work-form" onSubmit={e=>{e.preventDefault();void act(()=>rendition(row,new FormData(e.currentTarget)));}}><fieldset disabled={busy||pendingRenditions[row.id]}>
          <ReportRedactionChoices caseId={caseId} revisionId={row.id} reportSha256={row.sha256}/>
          <label className="form-label">Redaction reason<textarea name="reason" required minLength={10} maxLength={500}/></label>
          <label><input type="checkbox" required/> I understand this omits whole findings only and requires independent review before any disclosure.</label><button className="secondary">Create redacted PDF</button>
        </fieldset></form></details>
      <details><summary>Review this frozen revision</summary><p>A different assigned reviewer must decide. Conflicting decisions remain separate; none releases the report. Download, verify and inspect its exact contents first.</p>
        <form className="work-form" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void act(()=>review(row,data));}}><fieldset disabled={busy||!verified[row.id]}>
          <label className="form-label">Decision<select name="decision"><option value="request_changes">Request changes</option><option value="accept_internal">Accept internal draft</option></select></label>
          <label className="form-label">Review rationale<textarea name="reason" required minLength={10} maxLength={2000}/></label>
          <label><input type="checkbox" required/> I inspected this exact frozen draft. This decision is permanent and does not approve client release.</label>
          <button className="secondary" type="submit">Record internal review</button>
        </fieldset></form></details>
      <details><summary>Create a restricted release</summary><p>Only a separately accepted frozen revision may be released. Document-backed revisions require the exact package verified above; report and package fingerprints remain distinct.</p>
        {pendingReleases[row.id]&&<><p role="status">A release request has no confirmed receipt. Recover it with the same stable request identity before creating another.</p><button className="secondary" disabled={busy} onClick={()=>void act(()=>release(row))}>Recover pending release</button></>}
        <form className="work-form" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void act(()=>release(row,data));}}><fieldset disabled={busy||(!verified[row.id]&&!verifiedPackages[row.id])}>
          <label className="form-label">Client recipient UUID<input name="recipientId" required pattern="[a-fA-F0-9-]{36}"/></label>
          <label className="form-label">Expiry (UTC ISO 8601)<input name="expiresAt" required placeholder="2026-10-30T12:00:00.000Z"/></label>
          <label className="form-label">Release reason<textarea name="reason" required minLength={10} maxLength={2000}/></label>
          <label><input type="checkbox" required/> I reviewed this exact deliverable, its limitations and disclosure scope. Release does not certify source truth.</label>
          <button className="secondary" type="submit">Create restricted release</button>
        </fieldset></form></details>
    </li>)}</ul>
    {next&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>load(true))}>Load older revisions</button>}
  </div></Panel></>;
}
