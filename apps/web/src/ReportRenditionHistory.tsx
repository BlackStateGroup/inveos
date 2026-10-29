import {useEffect,useRef,useState} from 'react';
import {readReportPdfBytes,verifyReportPdfDownload} from './reportPdfDownload';
import {PdfRenditionControls} from './PdfRenditionControls';

type Receipt={id:string;caseId:string;revisionId:string;status:string;format:string;sourceReportSha256:string;pdfSha256:string;redactionSha256:string;redactedFindingCount:number;createdAt:string};
type Page={items:Receipt[];nextBefore:string|null};
export function ReportRenditionHistory({caseId,revisionId,reportSha256,csrf}:{caseId:string;revisionId:string;reportSha256:string;csrf:string}){
 const [rows,setRows]=useState<Receipt[]>([]),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 const [verified,setVerified]=useState<string|null>(null);
 useEffect(()=>()=>{active.current?.abort();},[]);
 const base=`/api/cases/${caseId}/report-revisions/${revisionId}/renditions`;
 async function run(work:(signal:AbortSignal)=>Promise<void>){
  active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);setError('');setMessage('');setVerified(null);
  try{await work(controller.signal);}catch(e){if(!controller.signal.aborted){setRows([]);setNext(null);setError(e instanceof Error?e.message:'Rendition request failed.');}}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 async function load(signal:AbortSignal,before?:string){
  const response=await fetch(`${base}?limit=25${before?`&before=${encodeURIComponent(before)}`:''}`,{signal,credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Could not load saved PDF renditions.');
  const page=await response.json() as Page;
  if(!Array.isArray(page.items)||page.items.length>25||!(page.nextBefore===null||typeof page.nextBefore==='string')||page.items.some(row=>row.caseId!==caseId||row.revisionId!==revisionId||row.sourceReportSha256!==reportSha256||row.status!=='internal_rendition_not_released'||row.format!=='pdf'||!/^[-a-f0-9]{36}$/i.test(row.id)||!/^[a-f0-9]{64}$/.test(row.pdfSha256)||!/^[a-f0-9]{64}$/.test(row.redactionSha256)||!Number.isInteger(row.redactedFindingCount)||row.redactedFindingCount<0))throw new Error('Saved rendition receipt mismatch.');
  if(signal.aborted)return;
  setRows(old=>before?[...old,...page.items.filter(row=>!old.some(item=>item.id===row.id))]:page.items);setNext(page.nextBefore);setMessage(page.items.length?'Saved PDF renditions loaded.':'No saved PDF renditions.');
 }
 async function download(row:Receipt,signal:AbortSignal){
  const response=await fetch(`${base}/${row.id}`,{signal,credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Could not verify the saved PDF rendition.');
  const bytes=await readReportPdfBytes(response);await verifyReportPdfDownload(bytes,row.pdfSha256,reportSha256,response.headers.get('X-INVEOS-PDF-SHA256'),response.headers.get('X-INVEOS-Report-SHA256'));
  if(signal.aborted)return;
  setVerified(row.id);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),link=document.createElement('a');link.href=url;link.download=`internal-report-${row.id}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Saved PDF verified and downloaded. No new rendition was created.');
 }
 return <details><summary>Saved PDF renditions</summary>
  <p>Retrieve an existing PDF without generating another version. Client delivery requires independent PDF review and an explicit recipient disclosure.</p>
  <button className="secondary" disabled={busy} onClick={()=>void run(signal=>load(signal))}>Load saved PDFs {revisionId.slice(0,8)}</button>
  {error&&<p role="alert">{error} Retry loading saved PDFs.</p>}<p role="status">{busy?'Verifying saved renditions…':message}</p>
  <ul>{rows.map(row=><li key={row.id}><p>{row.redactedFindingCount?`${row.redactedFindingCount} findings redacted`:'Unredacted'} · {row.createdAt}</p>
   <label>PDF SHA-256<input readOnly value={row.pdfSha256}/></label><button className="secondary" disabled={busy} onClick={()=>void run(signal=>download(row,signal))}>Download saved PDF {row.id.slice(0,8)}</button>
   <PdfRenditionControls key={row.id} caseId={caseId} revisionId={revisionId} renditionId={row.id} pdfSha256={row.pdfSha256} redactionSha256={row.redactionSha256} csrf={csrf} verified={verified===row.id}/></li>)}</ul>
  {next&&<button className="secondary" disabled={busy} onClick={()=>void run(signal=>load(signal,next))}>More saved PDFs</button>}
 </details>;
}
