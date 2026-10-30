import {useEffect,useRef,useState,type FormEvent} from 'react';
import {caseSensitivityTiers,type CaseHandling as Handling,type CaseSensitivityTier,type CaseSharing} from '@inveos/contracts';
import {Badge,Panel} from './ui';

export function CaseHandling({caseId,csrf,onSaved}:{caseId:string;csrf:string;onSaved:()=>Promise<unknown>}){
 const [data,setData]=useState<Handling|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [tier,setTier]=useState<CaseSensitivityTier>('sensitive'),[sharing,setSharing]=useState<CaseSharing>('internal_only'),[instructions,setInstructions]=useState(''),[reason,setReason]=useState('');
 const live=useRef(true),working=useRef(false),pending=useRef<null|{id:string;expectedVersion:number;expectedAuthorityVersion:number|null;tier:CaseSensitivityTier;sharing:CaseSharing;instructions:string;reason:string}>(null);
 const base='/api/cases/'+caseId+'/handling';
 async function api(path='',body?:unknown):Promise<Handling>{
  const response=await fetch(base+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:undefined,...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'Handling decisions unavailable.'),{status:response.status});return value;
 }
 function accept(value:Handling){setData(value);setTier(value.current?.tier??'sensitive');setSharing(value.current?.sharing??'internal_only');setInstructions(value.current?.instructions??'');setReason('');pending.current=null;}
 function failed(e:unknown){if(!live.current)return;setError((e as Error).message);if([401,403,404].includes((e as {status?:number}).status??0)){setData(null);setInstructions('');setReason('');pending.current=null;void onSaved().catch(()=>{});}}
 async function load(before?:number){if(working.current)return;working.current=true;setBusy(true);setError('');try{let value=await api(before?'?before='+before:'');if(before&&value.version!==data?.version){value=await api();before=undefined;}if(live.current){if(before)setData({...value,history:[...(data?.history??[]),...value.history]});else accept(value);}}catch(e){failed(e);}finally{working.current=false;if(live.current)setBusy(false);}}
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[caseId]);
 async function save(e:FormEvent){e.preventDefault();if(!data||working.current)return;working.current=true;setBusy(true);setError('');pending.current??={id:crypto.randomUUID(),expectedVersion:data.version,expectedAuthorityVersion:data.authorityVersion,tier,sharing,instructions,reason};
  try{const value=await api('',pending.current);if(live.current)accept(value);await onSaved();}catch(e){failed(e);}finally{working.current=false;if(live.current)setBusy(false);}
 }
 return <Panel title="Sensitivity and handling" meta={<Badge>{data?.current?.tier??'Unassessed'}</Badge>}><div className="panel-body">
  <button className="secondary" disabled={busy} onClick={()=>void load()}>Refresh handling decisions</button>{busy&&<p role="status">Checking case handling…</p>}{error&&<p role="alert" className="form-error">{error}</p>}
  {data&&<>
   <p>{data.current?'Handling decision v'+data.version+'.':'No sensitivity decision has been recorded; existing release controls still apply.'} {data.sharingAllowed?'Every recipient still needs a separately approved release or work grant.':data.blockReason}</p>
   <p className="small muted">Sensitivity labels describe the case. Internal-only use blocks external access to this case’s releases and collaborator work. Instructions guide investigators; they do not change encryption, internal membership or downloaded copies.</p>
   {data.current&&<p className="work-body">{data.current.instructions}</p>}
   {data.canDecide&&<form aria-label="Case handling decision" onSubmit={save}>
    <div className="work-form-grid"><label className="form-label">Sensitivity tier<select value={tier} disabled={busy} onChange={e=>{setTier(e.target.value as CaseSensitivityTier);pending.current=null;}}>{caseSensitivityTiers.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    <label className="form-label">Recipient sharing<select value={sharing} disabled={busy} onChange={e=>{setSharing(e.target.value as CaseSharing);pending.current=null;}}><option value="internal_only">Internal only</option><option value="existing_release_controls">Allow separately approved sharing</option></select></label></div>
    <label className="form-label">Handling instructions<textarea required minLength={10} maxLength={2000} disabled={busy} value={instructions} onChange={e=>{setInstructions(e.target.value);pending.current=null;}} placeholder="Record minimisation, handling and disclosure instructions for this case."/></label>
    <label className="form-label">Decision reason<textarea required minLength={10} maxLength={2000} disabled={busy} value={reason} onChange={e=>{setReason(e.target.value);pending.current=null;}}/></label>
    <p className="small muted">This decision binds to authority {data.authorityVersion?'v'+data.authorityVersion:'not yet approved'}. A changed authority or removed authorising reviewer requires a fresh decision before sharing can resume. Existing release expiry and revocation still apply.</p>
    <button className="primary" disabled={busy}>Record handling decision</button>
   </form>}
   <details><summary>Handling history ({data.history.length} loaded)</summary>{data.history.map(item=><article className="work-record" key={item.id}><strong>v{item.version} · {item.tier} · {item.sharing==='internal_only'?'Internal only':'Separate sharing approval required'}</strong><p className="work-body">{item.instructions}</p><p className="work-body">Reason: {item.reason}</p><p className="small">Recorded {item.recordedAt} by {item.actorName} · authority {item.authorityVersion?'v'+item.authorityVersion:'unapproved'}</p><p className="small wrap-anywhere">SHA-256 {item.sha256}</p></article>)}{data.nextBefore&&<button className="secondary" disabled={busy} onClick={()=>void load(data.nextBefore!)}>Earlier handling decisions</button>}</details>
  </>}
 </div></Panel>;
}
