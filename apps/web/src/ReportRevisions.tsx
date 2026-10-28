import {useEffect, useRef, useState} from 'react';
import {verifyRevisionDownload} from './reportDownload';
import {pendingReportFreeze, recoverableReportFreeze, reportRecoveryScope} from './reportRecovery';
import {Panel, Notice} from './ui';
import {DisclosureHistory} from './DisclosureHistory';

type Receipt={id:string;caseId:string;status:string;sha256:string;createdAt:string};
type Page={items:Receipt[];nextBefore:string|null};
async function json<T>(url:string,signal?:AbortSignal,body?:object,csrf?:string):Promise<T>{
  const response=await fetch(url,{signal,credentials:'same-origin',method:body?'POST':'GET',
    headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf||''}:{},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Report request failed.');return result;
}
export function ReportRevisions({caseId,csrf}:{caseId:string;csrf:string}){
  const [rows,setRows]=useState<Receipt[]>([]),[next,setNext]=useState<string|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [pending,setPending]=useState(false);
  const [reviewHistory,setReviewHistory]=useState<Record<string,Array<{id:string;decision:string;reason:string;reviewerId:string;createdAt:string}>>>({});
  const [verified,setVerified]=useState<Record<string,boolean>>({});
  const inFlight=useRef(false),alive=useRef(true);
  const base=`/api/cases/${caseId}/report-revisions`;
  useEffect(()=>{
    alive.current=true;const controller=new AbortController();
    void Promise.all([json<Page>(base,controller.signal),reportRecoveryScope(csrf,caseId)]).then(([page,scope])=>{
      if(controller.signal.aborted)return;
      setRows(page.items);setNext(page.nextBefore);setPending(!!pendingReportFreeze(window.sessionStorage,scope));
    })
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>{alive.current=false;controller.abort();};
  },[base,csrf,caseId]);
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
  return <><DisclosureHistory key={`${caseId}:${csrf}`} caseId={caseId} csrf={csrf}/><Panel title="Saved internal report revisions"><div className="panel-body">
    <Notice>Freeze reviewed findings and working context at a point in time. Saved revisions do not change with the case and are not client releases.</Notice>
    <div className="report-export-actions"><button className="primary" disabled={busy} onClick={()=>void act(freeze)}>{pending?'Recover pending freeze':'Freeze current internal draft'}</button>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>load())}>Refresh revisions</button></div>
    {pending&&<p role="status">A previous freeze has no confirmed receipt. Recover it before starting another revision.</p>}
    <p className="small muted">Retry recovery lasts for this tab and sign-in. After signing out or closing the tab, check saved revisions before freezing again.</p>
    {error&&<p className="form-error" role="alert">{error} Retry the action when ready.</p>}
    <p role="status">{busy?'Loading report revisions…':message||(!rows.length?'No saved revisions yet.':'')}</p>
    <ul>{rows.map(row=><li key={row.id}>
      <p><strong>Internal draft · {new Date(row.createdAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</strong></p>
      <label className="form-label">SHA-256 for revision {row.id}<input readOnly value={row.sha256}/></label>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>download(row))}>Download revision {row.id.slice(0,8)}</button>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>verifySources(row))}>Reverify cited originals</button>
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>reviews(row))}>Inspect review decisions</button>
      {reviewHistory[row.id]?.map(item=><p key={item.id}>{item.decision} · reviewer {item.reviewerId} · {item.createdAt}: {item.reason}</p>)}
      <details><summary>Review this frozen revision</summary><p>A different assigned reviewer must decide. Conflicting decisions remain separate; none releases the report. Download, verify and inspect its exact contents first.</p>
        <form className="work-form" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void act(()=>review(row,data));}}><fieldset disabled={busy||!verified[row.id]}>
          <label className="form-label">Decision<select name="decision"><option value="request_changes">Request changes</option><option value="accept_internal">Accept internal draft</option></select></label>
          <label className="form-label">Review rationale<textarea name="reason" required minLength={10} maxLength={2000}/></label>
          <label><input type="checkbox" required/> I inspected this exact frozen draft. This decision is permanent and does not approve client release.</label>
          <button className="secondary" type="submit">Record internal review</button>
        </fieldset></form></details>
    </li>)}</ul>
    {next&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>load(true))}>Load older revisions</button>}
  </div></Panel></>;
}
