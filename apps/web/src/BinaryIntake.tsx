import {UploadMaintenance} from './UploadMaintenance';
import {binaryUploadRoute,uploadBinaryChunks,type UploadProgress} from './chunkUpload';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {binaryIntakeScope,clearCancelledBinary,pendingBinary,prepareBinary,sendBinaryRecoverably} from './binaryIntake';
import {Panel,Notice} from './ui';
export function BinaryIntake({caseId,csrf,onSaved}:{caseId:string;csrf:string;onSaved:()=>Promise<unknown>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(''),[pending,setPending]=useState(false);
  const [progress,setProgress]=useState<UploadProgress|null>(null),[maintaining,setMaintaining]=useState(false);
  function maintenanceBusy(value:boolean){locked.current=value;setMaintaining(value);}
  const alive=useRef(true),locked=useRef(false),transfer=useRef<AbortController|null>(null);
  useEffect(()=>{alive.current=true;let cancelled=false;void binaryIntakeScope(csrf,caseId).then(scope=>{if(!cancelled)setPending(!!pendingBinary(sessionStorage,scope)||!!pendingBinary(sessionStorage,scope+':chunks-v1'));}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;alive.current=false;transfer.current?.abort();};},[caseId,csrf]);
  async function reconcileCancellation(){
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setReceipt('');
    const controller=new AbortController();transfer.current=controller;
    try{
      const oldScope=await binaryIntakeScope(csrf,caseId),route=binaryUploadRoute(sessionStorage,oldScope);
      if(route.legacy)throw new Error('This is an older whole-file request. Recover its original receipt with the same file and metadata.');
      await clearCancelledBinary(sessionStorage,route.scope,caseId,async key=>{
        const response=await fetch(`/api/cases/${caseId}/uploads/by-key/${key}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
        if(!response.ok)throw new Error('Reservation could not be checked. The pending key is retained.');return response.json();
      });
      if(alive.current){setPending(false);setProgress(null);setReceipt('Cancelled reservation confirmed. You can register a replacement using your local original.');}
    }catch(e){if(alive.current)setError((e as Error).message);}finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(locked.current)return;const data=new FormData(event.currentTarget);locked.current=true;setBusy(true);setError('');setReceipt('');setProgress(null);const controller=new AbortController();transfer.current=controller;
    try{
      const file=data.get('file');if(!(file instanceof File))throw new Error('Choose an original file.');
      const input=await prepareBinary(file,String(data.get('sourceTime')||''),String(data.get('method')||''));
      const oldScope=await binaryIntakeScope(csrf,caseId),{scope,legacy}=binaryUploadRoute(sessionStorage,oldScope);
      try{
        const result=await sendBinaryRecoverably(sessionStorage,scope,caseId,input,async body=>{
          const send=async(path:string,payload?:unknown)=>{
            const response=await fetch(path,{method:payload===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
            const value=await response.json();if(!response.ok)throw new Error(value.error||'Intake failed.');return value;
          };
          // Existing whole-request retries must never be converted into a new reservation.
          return legacy?send(`/api/cases/${caseId}/evidence/binary`,body):uploadBinaryChunks(caseId,body,send,p=>{if(alive.current)setProgress(p);},controller.signal);
        });
        if(alive.current){setReceipt(`Original ${result.id} confirmed in quarantine. SHA-256: ${result.digest}`);await onSaved();}
      }finally{if(alive.current)setPending(!!pendingBinary(sessionStorage,oldScope)||!!pendingBinary(sessionStorage,oldScope+':chunks-v1'));}
    }catch(e){if(alive.current)setError((e as Error).message);}finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  return <><Panel title="Register a binary original"><div className="panel-body"><Notice>Fictional files only, up to 256 KiB. Originals remain quarantined: no malware scan, OCR, preview or findings are implied. Keep your original file.</Notice>
    {pending&&<p role="status">Unconfirmed intake: reselect the same file and enter its exact original timestamp and method to recover the receipt.</p>}
    {pending&&<button className="secondary" disabled={busy||maintaining} onClick={()=>void reconcileCancellation()}>Confirm cancellation and clear this retry</button>}
    <form className="work-form" onSubmit={e=>void submit(e)}><fieldset disabled={busy||maintaining}><label className="form-label">Original file<input name="file" type="file" required/></label><label className="form-label">Source timestamp including timezone<input name="sourceTime" placeholder="2026-01-12T09:00:00Z" required maxLength={64}/></label><label className="form-label">Acquisition method<input name="method" required minLength={5} maxLength={500}/></label><button className="primary" type="submit">{busy?'Confirming intake…':pending?'Recover original receipt':'Register in quarantine'}</button></fieldset></form>{busy&&<button className="secondary" onClick={()=>transfer.current?.abort()}>Pause transfer</button>}{progress&&<p role="status">Reservation {progress.id}: {progress.receivedBytes} of {progress.totalBytes} bytes acknowledged. Expires {progress.expiresAt}.</p>}
    {error&&<p role="alert">{error}</p>}{receipt&&<p role="status">{receipt}</p>}<p>Only a retry key and request fingerprint are stored in this tab. Recovery requires the same sign-in, file and metadata; missing chunks resume from server receipts. This is not durable offline storage. Pausing does not cancel or delete the reservation.</p></div></Panel><UploadMaintenance caseId={caseId} csrf={csrf} transferring={busy} onBusyChange={maintenanceBusy}/></>;
}
