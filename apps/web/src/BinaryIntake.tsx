import {useEffect,useRef,useState,type FormEvent} from 'react';
import {binaryIntakeScope,pendingBinary,prepareBinary,sendBinaryRecoverably} from './binaryIntake';
import {Panel,Notice} from './ui';
export function BinaryIntake({caseId,csrf,onSaved}:{caseId:string;csrf:string;onSaved:()=>Promise<unknown>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(''),[pending,setPending]=useState(false);
  const alive=useRef(true),locked=useRef(false);
  useEffect(()=>{alive.current=true;let cancelled=false;void binaryIntakeScope(csrf,caseId).then(scope=>{if(!cancelled)setPending(!!pendingBinary(sessionStorage,scope));}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;alive.current=false;};},[caseId,csrf]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(locked.current)return;const data=new FormData(event.currentTarget);locked.current=true;setBusy(true);setError('');setReceipt('');
    try{
      const file=data.get('file');if(!(file instanceof File))throw new Error('Choose an original file.');
      const input=await prepareBinary(file,String(data.get('sourceTime')||''),String(data.get('method')||''));
      const scope=await binaryIntakeScope(csrf,caseId);
      try{
        const result=await sendBinaryRecoverably(sessionStorage,scope,caseId,input,async body=>{
          const response=await fetch(`/api/cases/${caseId}/evidence/binary`,{method:'POST',cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
          const value=await response.json();if(!response.ok)throw new Error(value.error||'Intake failed.');return value;
        });
        if(alive.current){setReceipt(`Original ${result.id} confirmed in quarantine. SHA-256: ${result.digest}`);await onSaved();}
      }finally{if(alive.current)setPending(!!pendingBinary(sessionStorage,scope));}
    }catch(e){if(alive.current)setError((e as Error).message);}finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  return <Panel title="Register a binary original"><div className="panel-body"><Notice>Fictional files only, up to 256 KiB. Originals remain quarantined: no malware scan, OCR, preview or findings are implied. Keep your original file.</Notice>
    {pending&&<p role="status">Unconfirmed intake: reselect the same file and enter its exact original timestamp and method to recover the receipt.</p>}
    <form className="work-form" onSubmit={e=>void submit(e)}><fieldset disabled={busy}><label className="form-label">Original file<input name="file" type="file" required/></label><label className="form-label">Source timestamp including timezone<input name="sourceTime" placeholder="2026-01-12T09:00:00Z" required maxLength={64}/></label><label className="form-label">Acquisition method<input name="method" required minLength={5} maxLength={500}/></label><button className="primary" type="submit">{busy?'Confirming intake…':pending?'Recover original receipt':'Register in quarantine'}</button></fieldset></form>
    {error&&<p role="alert">{error}</p>}{receipt&&<p role="status">{receipt}</p>}<p>Only a retry key and request fingerprint are stored in this tab. Recovery requires the same sign-in, file and metadata; this is not resumable chunk transfer or offline storage.</p></div></Panel>;
}
