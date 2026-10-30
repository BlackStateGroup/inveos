import {useRef,useState,type FormEvent} from 'react';
import type {DocumentReportFinding,DocumentWorkLinkInput,WorkLink} from '@inveos/contracts';
import {Notice} from './ui';

type Link=Extract<WorkLink,{kind:'document_finding'}>;
type Candidates={items:Array<{id:string;text:string}>;nextAfter:string|null};
export function DocumentWorkSources({caseId,itemId,links,save,withdraw,inspect}:{caseId:string;itemId:string;links:Link[];save:(id:string,input:DocumentWorkLinkInput)=>Promise<void>;withdraw:(itemId:string,linkId:string,reason:string)=>Promise<void>;inspect:(id:string)=>void}){
  const [candidates,setCandidates]=useState<Candidates|null>(null),[finding,setFinding]=useState<DocumentReportFinding|null>(null);
  const [selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [withdrawing,setWithdrawing]=useState<string|null>(null);
  const requestId=useRef(crypto.randomUUID()),lock=useRef(false);
  const base=`/api/cases/${caseId}/work/document-findings`;
  async function get<T>(url:string):Promise<T>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)});const value=await r.json();if(!r.ok)throw new Error(value.error||'Document source unavailable.');return value;}
  async function act(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
  async function load(more=false){const page=await get<Candidates>(base+(more&&candidates?.nextAfter?'?after='+candidates.nextAfter:''));setCandidates(old=>more&&old?{...page,items:[...old.items,...page.items.filter(p=>!old.items.some(o=>o.id===p.id))]}:page);}
  async function verify(id:string){setFinding(null);setSelected(id);const value=await get<DocumentReportFinding>(base+'/'+id);if(value.kind!=='derived_document'||value.id!==id)throw new Error('Document finding identity mismatch.');setFinding(value);}
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const fields=new FormData(event.currentTarget);await act(async()=>{
    if(!finding||finding.id!==selected)throw new Error('Inspect and reverify a reviewed document finding first.');
    await save(itemId,{id:requestId.current,findingId:finding.id,relation:String(fields.get('relation')) as DocumentWorkLinkInput['relation'],reason:String(fields.get('reason'))});requestId.current=crypto.randomUUID();setCandidates(null);
  });}
  return <section aria-label="Reviewed document reasoning sources">
    <h4>Reviewed document sources</h4>
    <p className="small muted">Links and saved assessments are historical working context. Inspect to check current authority, original bytes and review decisions. They do not make a hypothesis a finding.</p>
    {links.map(link=><div className="work-source" key={link.id}><strong>{link.withdrawal ? 'Withdrawn · ' : ''}{link.relation==='supports'?'Supporting material':link.relation==='contradicts'?'Contrary material':'Context only'}</strong><p>{link.reason}</p>
      <p className="small">Finding {link.findingId} · linked {new Date(link.createdAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</p>
      <div className="work-record-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>void act(()=>verify(link.findingId))}>Inspect document finding {link.findingId.slice(0,8)}</button>{link.withdrawal?<p>Withdrawal: {link.withdrawal.reason} · {link.withdrawal.createdAt}</p>:<button type="button" disabled={busy} onClick={()=>setWithdrawing(link.id)}>Withdraw source link {link.id.slice(0,8)}</button>}</div></div>)}
    {withdrawing&&<form aria-label="Withdraw document source link" onSubmit={e=>{e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason'));void act(async()=>{await withdraw(itemId,withdrawing,reason);setWithdrawing(null);setFinding(null);});}}><fieldset disabled={busy}><label className="form-label">Reason for withdrawing source<textarea name="reason" required maxLength={3000}/></label><button type="submit">Record source withdrawal</button><button type="button" onClick={()=>setWithdrawing(null)}>Cancel withdrawal</button></fieldset></form>}
    <button type="button" className="text-button" disabled={busy} onClick={()=>void act(()=>load())}>Choose a reviewed document finding</button>
    {busy&&<p role="status">Checking document source…</p>}{error&&<p role="alert" className="form-error">{error} Saved links remain in history; inspect again to retry.</p>}
    {candidates&&<form aria-label="Link reviewed document finding" onSubmit={event=>void submit(event)}><fieldset disabled={busy}>
      <Notice>Listed findings are historical candidates. Current review and authority are checked before inspection and every save.</Notice>
      <label className="form-label">Document finding<select value={selected} onChange={e=>{setSelected(e.target.value);setFinding(null);}}><option value="">Choose a finding</option>{candidates.items.map(c=><option key={c.id} value={c.id}>{c.text}</option>)}</select></label>
      {candidates.nextAfter&&<button type="button" onClick={()=>void act(()=>load(true))}>Load more document findings</button>}
      <button type="button" disabled={!selected} onClick={()=>void act(()=>verify(selected))}>Inspect selected document finding</button>
      <label className="form-label">How does this document relate?<select name="relation"><option value="supports">Supporting material</option><option value="contradicts">Contrary material</option><option value="context">Context only</option></select></label>
      <label className="form-label">Document relevance reason<textarea name="reason" required maxLength={3000}/></label>
      <button className="secondary" type="submit" disabled={!finding}>Save document source link</button>
    </fieldset></form>}
    {finding&&<article aria-label="Verified document reasoning source"><h4>{finding.source.filename} · page {finding.reference.page}</h4><blockquote>{finding.reference.quote}</blockquote><p>{finding.text}</p>
      <dl><dt>Exact extraction location</dt><dd>{finding.reference.itemRef} · bytes [{finding.reference.startByte}, {finding.reference.endByte}) · {finding.reference.offsetBasis}</dd>
      <dt>Page region</dt><dd>{JSON.stringify(finding.reference.bbox)}</dd><dt>Original SHA-256</dt><dd className="digest">{finding.source.sha256}</dd>
      <dt>Source-recorded time</dt><dd>{finding.source.sourceTime}</dd><dt>Received time</dt><dd>{finding.source.receivedTime}</dd><dt>Processed time</dt><dd>{finding.extraction.processedAt}</dd>
      <dt>Correspondence review</dt><dd>{finding.correspondence.reason}</dd><dt>Interpretation decision</dt><dd>{finding.interpretation.reason}</dd></dl><p>{finding.limitations}</p>
      <button type="button" className="text-button" onClick={()=>inspect(finding.source.id)}>Open original and page comparison</button><p className="small muted">Processing job {finding.extraction.jobId} · citation {finding.reference.citationId}. Reuse this exact source and job in the evidence workspace.</p>
    </article>}
  </section>;
}
