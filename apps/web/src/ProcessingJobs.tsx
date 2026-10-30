import {DocumentCitations} from './DocumentCitations';
import {pairRasterDocument} from './rasterOverlay';
import {RasterInspection} from './RasterInspection';
import {inspectRaster,type InspectedRaster} from './rasterInspection';
import {DocumentRegionMap} from './DocumentRegionMap';
import {inspectDocumentDerivative,type InspectedDocument} from './documentInspection';
import {useEffect,useRef,useState} from 'react';
import {inspectTextDerivative,type InspectedDerivative} from './derivativeInspection';
import type {Evidence} from '@inveos/contracts';
import {jobRequestScope,pendingJob,queueRecoverably,type JobKind,type PendingJob} from './jobRequest';
import {Panel,Notice} from './ui';
type Job={id:string;caseId:string;evidenceId:string;kind:string;status:string;attempt:number;authorityVersion:number;sourceDigest:string;failureCode:string|null};
type Event={id:string;status:string;attempt:number;failureCode:string|null;recordedAt:string};
type Page={items:Job[];nextBefore:string|null};
export function ProcessingJobs({caseId,csrf,evidence,requestedJobId,requestedCitationId,onSource,onDenied}:{caseId:string;csrf:string;evidence:Evidence[];requestedJobId?:string;requestedCitationId?:string;onSource?:(id:string)=>void;onDenied?:()=>Promise<unknown>}){
  const [source,setSource]=useState(evidence[0]?.id||''),[kind,setKind]=useState<JobKind>('original_sha256_v1'),[pending,setPending]=useState<PendingJob|null>(null);
  const [rows,setRows]=useState<Job[]>([]),[next,setNext]=useState<string|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(true);
  const [inspection,setInspection]=useState<InspectedDerivative|null>(null),[linePage,setLinePage]=useState(0);
  const [raster,setRaster]=useState<InspectedRaster|null>(null);
  const [document,setDocument]=useState<InspectedDocument|null>(null);
  const documentRegion=useRef<HTMLElement|null>(null),focusRequested=useRef(false);
  useEffect(()=>{if(document&&focusRequested.current){focusRequested.current=false;documentRegion.current?.scrollIntoView({block:'start'});documentRegion.current?.focus({preventScroll:true});}},[document]);
  const [history,setHistory]=useState<{jobId:string;items:Event[];nextAfter:string|null}|null>(null);
  const alive=useRef(true),locked=useRef(false),base=`/api/cases/${caseId}/integrity-jobs`;
  async function get<T>(url:string,signal?:AbortSignal):Promise<T>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});const value=await r.json();if(!r.ok){if([401,403,404].includes(r.status)&&alive.current){setRows([]);setNext(null);setInspection(null);setDocument(null);setRaster(null);setHistory(null);setPending(null);await onDenied?.();}throw new Error(value.error||'Processing history unavailable.');}return value;}
  useEffect(()=>{alive.current=true;setDocument(null);setInspection(null);setRaster(null);setHistory(null);setBusy(true);const controller=new AbortController();
    void get<Page>(base,controller.signal).then(async p=>{if(controller.signal.aborted)return;setRows(p.items);setNext(p.nextBefore);
      if(requestedJobId)await inspectRequested(controller.signal);
    })
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    void jobRequestScope(csrf,caseId).then(scope=>{if(!controller.signal.aborted)setPending(pendingJob(window.sessionStorage,scope));}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>{alive.current=false;controller.abort();};
  },[base,csrf,caseId,requestedJobId]);
  async function inspectRequested(signal?:AbortSignal){
    if(!requestedJobId)return;
    const job=await get<Job>(base+'/'+requestedJobId,signal);
    if(job.id!==requestedJobId||job.caseId!==caseId||job.status!=='succeeded'||!['native_pdf_lab_v1','tesseract_scan_lab_v1','tesseract_scan_lab_v2'].includes(job.kind))throw new Error('Selected extraction is unavailable.');
    const checked=await inspectDocumentDerivative(await get<unknown>(base+'/'+job.id+'/document-derivative',signal),job);
    if(alive.current&&!signal?.aborted){focusRequested.current=true;setSource(job.evidenceId);onSource?.(job.evidenceId);setDocument(checked);setHistory(null);setRows(old=>old.some(v=>v.id===job.id)?old:[job,...old]);}
  }
  async function act(operation:()=>Promise<void>){if(locked.current)return;locked.current=true;setBusy(true);setError('');setMessage('');setInspection(null);setDocument(null);setRaster(null);setLinePage(0);
    try{await operation();}catch(e){if(alive.current)setError((e as Error).message);}finally{locked.current=false;if(alive.current)setBusy(false);}}
  async function load(older=false){const p=await get<Page>(`${base}${older&&next?`?before=${next}`:''}`);if(!alive.current)return;
    setRows(old=>older?[...old,...p.items.filter(x=>!old.some(y=>y.id===x.id))]:p.items);setNext(p.nextBefore);setHistory(null);}
  async function events(jobId:string,after?:string){const p=await get<{items:Event[];nextAfter:string|null}>(`${base}/${jobId}/events${after?`?after=${after}`:''}`);
    if(alive.current)setHistory(old=>({jobId,items:after&&old?.jobId===jobId?[...old.items,...p.items]:p.items,nextAfter:p.nextAfter}));}
  async function queue(){
    const scope=await jobRequestScope(csrf,caseId),store=window.sessionStorage;
    try{
      const receipt=await queueRecoverably(store,scope,caseId,{evidenceId:source,kind},async payload=>{
        const r=await fetch(base,{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(payload)});
        const value=await r.json();if(!r.ok)throw new Error(value.error||'Queue request failed.');return value;
      });
      if(alive.current){setMessage(`Job ${receipt.id} confirmed (${receipt.status}). Refresh history if it is not visible below.`);await load();}
    }finally{if(alive.current)setPending(pendingJob(store,scope));}
  }
  async function inspect(job:Job){
    const result=await get<unknown>(`${base}/${job.id}/derivative`);
    const checked=await inspectTextDerivative(result,job);
    if(alive.current){setSource(job.evidenceId);onSource?.(job.evidenceId);setInspection(checked);setHistory(null);}
  }
  async function inspectDocument(job:Job){
    const checked=await inspectDocumentDerivative(await get<unknown>(`${base}/${job.id}/document-derivative`),job);
    if(alive.current){setSource(job.evidenceId);onSource?.(job.evidenceId);setDocument(checked);setHistory(null);}
  }
  async function inspectImage(job:Job){const checked=await inspectRaster(await get<unknown>(`${base}/${job.id}/raster-derivative`),job);if(alive.current){setSource(job.evidenceId);onSource?.(job.evidenceId);setRaster(checked);setHistory(null);}}
  async function compareImage(job:Job,extraction:Job){
    const [image,passages]=await Promise.all([get<unknown>(`${base}/${job.id}/raster-derivative`).then(r=>inspectRaster(r,job)),get<unknown>(`${base}/${extraction.id}/document-derivative`).then(r=>inspectDocumentDerivative(r,extraction))]);
    pairRasterDocument(image,passages);
    if(alive.current){setSource(job.evidenceId);onSource?.(job.evidenceId);setRaster(image);setDocument(passages);setHistory(null);}
  }
  async function cancel(job:Job){const r=await fetch(`${base}/${job.id}/cancel`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'});
    const value=await r.json();if(!r.ok)throw new Error(value.error||'Cancellation failed.');if(!alive.current)return;
    setRows(old=>old.map(x=>x.id===job.id?value:x));await events(job.id);}
  return <Panel title="Original processing history"><div className="panel-body">
    <Notice>Checks and text indexes remain separate from findings. Successful processing does not clear binary quarantine or approve a citation. A trusted worker must execute queued jobs.</Notice>
    <form onSubmit={e=>{e.preventDefault();void act(queue);}}>
      <label className="form-label">Original to process<select required disabled={busy||!!pending} value={pending?.evidenceId||source} onChange={e=>{setSource(e.target.value);setKind('original_sha256_v1');}}>
        <option value="" disabled>Choose an original</option>{evidence.map(e=><option key={e.id} value={e.id}>{e.filename} · {e.id.slice(0,8)}</option>)}</select></label>
      <label className="form-label">Processing operation<select disabled={busy||!!pending} value={pending?.kind||kind} onChange={e=>setKind(e.target.value as JobKind)}>
        <option value="original_sha256_v1">Verify original SHA-256</option>
        <option value="utf8_line_index_v1" disabled={evidence.find(e=>e.id===source)?.originalKind!=='original_utf8'}>Build unreviewed UTF-8 line index</option></select></label>
      <button className="primary" disabled={busy||(!pending&&!source)}>{pending?'Recover pending processing request':'Queue processing job'}</button>
      {pending&&<p role="status">Recover the previous request before queuing another operation. Original: {pending.evidenceId}; operation: {pending.kind}.</p>}
      <p className="small muted">Queueing does not run the worker. Recovery lasts for this tab and sign-in; inspect job history after losing either.</p>
    </form>
    <button className="secondary" disabled={busy} onClick={()=>void act(()=>load())}>Refresh processing jobs</button>{requestedJobId&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>inspectRequested())}>Retry searched extraction</button>}
    {error&&<p role="alert" className="form-error">{error} Refresh to retry.</p>}
    <p role="status">{busy?'Loading processing jobs…':message||(!rows.length?'No processing jobs for this case.':'')}</p>
    <ul>{rows.map(job=><li key={job.id}><strong>{job.kind==='utf8_line_index_v1'?'UTF-8 line index':job.kind==='pdf_raster_lab_v2'?'PDF page images · 256 KiB profile':job.kind==='pdf_raster_lab_v1'?'PDF page images':job.kind==='tesseract_scan_lab_v2'?'Scanned PDF OCR lab · 256 KiB profile':job.kind==='tesseract_scan_lab_v1'?'Scanned PDF OCR lab':job.kind==='native_pdf_lab_v1'?'Native PDF lab':job.kind==='original_sha256_v1'?'Original SHA-256 check':'Unsupported operation'} · {job.status}</strong>
      <p>Evidence {job.evidenceId} · attempt {job.attempt} · authority version {job.authorityVersion}</p>
      <p>Original SHA-256: {job.sourceDigest}</p>{job.failureCode&&<p>Failure: {job.failureCode}</p>}
      <button className="secondary" disabled={busy} onClick={()=>void act(()=>events(job.id))}>View attempts {job.id.slice(0,8)}</button>
      {job.kind==='utf8_line_index_v1'&&job.status==='succeeded'&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>inspect(job))}>Inspect unreviewed lines {job.id.slice(0,8)}</button>}
      {['native_pdf_lab_v1','tesseract_scan_lab_v1','tesseract_scan_lab_v2'].includes(job.kind)&&job.status==='succeeded'&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>inspectDocument(job))}>Inspect unreviewed pages {job.id.slice(0,8)}</button>}
      {['pdf_raster_lab_v1','pdf_raster_lab_v2'].includes(job.kind)&&job.status==='succeeded'&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>inspectImage(job))}>Inspect page images {job.id.slice(0,8)}</button>}
      {['pdf_raster_lab_v1','pdf_raster_lab_v2'].includes(job.kind)&&job.status==='succeeded'&&rows.filter(d=>['native_pdf_lab_v1','tesseract_scan_lab_v1','tesseract_scan_lab_v2'].includes(d.kind)&&d.status==='succeeded'&&d.caseId===job.caseId&&d.evidenceId===job.evidenceId&&d.sourceDigest===job.sourceDigest&&d.authorityVersion===job.authorityVersion).map(d=><button key={d.id} className="secondary" disabled={busy} onClick={()=>void act(()=>compareImage(job,d))}>Compare image {job.id.slice(0,8)} with passages {d.id.slice(0,8)}</button>)}
      {['queued','running'].includes(job.status)&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>cancel(job))}>Cancel job {job.id.slice(0,8)}</button>}
    </li>)}</ul>
    {next&&<button className="secondary" disabled={busy} onClick={()=>void act(()=>load(true))}>Older jobs</button>}
    {inspection&&<section aria-label="Verified unreviewed text derivative">
      <h3>Unreviewed UTF-8 lines</h3><Notice>These are original-text line offsets, not PDF pages or approved findings. Continue through the existing claim and human-review workflow.</Notice>
      <p>Job {inspection.jobId} · evidence {inspection.evidenceId} · processing authority version {inspection.authorityVersion}</p>
      <p>Processor {inspection.processor} · {inspection.runtime} · processed {inspection.processedAt}</p>
      <p>Source SHA-256: {inspection.sourceDigest}</p><p>Derivative SHA-256: {inspection.derivativeDigest}</p><p>Processor source SHA-256: {inspection.processorDigest}</p>
      <p role="status">Lines {linePage*100+1}–{Math.min((linePage+1)*100,inspection.lines.length)} of {inspection.lines.length}</p>
      <ol start={linePage*100+1}>{inspection.lines.slice(linePage*100,(linePage+1)*100).map(line=><li key={line.line}><span>Original bytes [{line.startByte}, {line.endByte}) · next byte {line.nextByte}</span><pre className="source-excerpt">{line.text||'(empty line)'}</pre></li>)}</ol>
      <button className="secondary" disabled={linePage===0} onClick={()=>setLinePage(p=>p-1)}>Previous lines</button>
      <button className="secondary" disabled={(linePage+1)*100>=inspection.lines.length} onClick={()=>setLinePage(p=>p+1)}>Next lines</button>
    </section>}
    {document&&<section ref={documentRegion} tabIndex={-1} aria-label="Verified unreviewed document derivative">
      <h3>{document.method==='ocr'?'Unreviewed OCR words':'Unreviewed document passages'}</h3>{document.method==='ocr'&&<Notice>OCR may misread words, numbers and reading order. Compare each selected occurrence with the original page before independent review.</Notice>}<Notice>Extracted text and coordinates need comparison with the original PDF. This inspection does not approve a citation, clear quarantine or establish complete extraction.</Notice>
      <p>Job {document.jobId} · evidence {document.evidenceId} · authority version {document.authorityVersion}</p>
      <p>{document.pageCount} original pages · processed {document.processedAt}</p>
      <p role="status">{document.pagesWithoutText.length?`Pages without extracted text: ${document.pagesWithoutText.join(', ')}. Review these pages separately.`:'Text is present on every page. Completeness still needs human review.'}</p>
      <p>Original SHA-256: {document.sourceDigest}</p><p>Derivative SHA-256: {document.derivativeDigest}</p>
      <p>Raw output SHA-256: {document.rawDigest}</p><p>Runtime profile SHA-256: {document.profileDigest}</p>
      <DocumentRegionMap key={document.jobId} document={document}/>
      <DocumentCitations key={document.jobId+csrf+(requestedCitationId??'')} document={document} csrf={csrf} focusCitationId={document.jobId===requestedJobId?requestedCitationId:undefined}/>
      <ol start={linePage*100+1}>{document.references.slice(linePage*100,(linePage+1)*100).map(ref=><li key={ref.itemRef}>
        <p>Page {ref.page} · {ref.itemRef} · extracted UTF-8 bytes [{ref.startByte}, {ref.endByte})</p>
        <p>Region: left {ref.bbox.l}, right {ref.bbox.r}, bottom {ref.bbox.b}, top {ref.bbox.t} · origin {ref.bbox.origin}</p>
        {ref.ocr&&<p>OCR engine confidence {ref.ocr.confidence.toFixed(2)} · exact TSV row {ref.ocr.tsvRow}. Confidence does not verify accuracy.</p>}
        <pre className="source-excerpt">{ref.text}</pre></li>)}</ol>
      <button className="secondary" disabled={linePage===0} onClick={()=>setLinePage(p=>p-1)}>Previous passages</button>
      <button className="secondary" disabled={(linePage+1)*100>=document.references.length} onClick={()=>setLinePage(p=>p+1)}>Next passages</button>
    </section>}
    {raster&&<RasterInspection key={raster.job.id} raster={raster} document={document??undefined}/>}
    {history&&<section aria-label="Selected job attempts"><h3>Attempts for {history.jobId}</h3><ol>{history.items.map(e=><li key={e.id}>{e.status} · attempt {e.attempt} · {new Date(e.recordedAt).toISOString()} {e.failureCode||''}</li>)}</ol>
      {history.nextAfter&&<button disabled={busy} className="secondary" onClick={()=>void act(()=>events(history.jobId,history.nextAfter!))}>More attempts</button>}</section>}
  </div></Panel>;
}
