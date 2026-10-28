import type {Evidence} from '@inveos/contracts';
import {useEffect,useRef,useState} from 'react';
import {readOriginalDownload} from './originalDownload';
/** Mount with an identity key so a late response cannot cross evidence selection. */
export function OriginalDownload({evidence}:{evidence:Evidence}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState('');
 const alive=useRef(true),locked=useRef(false),controller=useRef<AbortController|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 async function download(){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setReceipt('');const transfer=new AbortController();controller.current=transfer;
  try{
   const response=await fetch(`/api/cases/${evidence.caseId}/evidence/${evidence.id}/original`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([transfer.signal,AbortSignal.timeout(30000)])});
   const bytes=await readOriginalDownload(response,evidence);if(!alive.current||transfer.signal.aborted)return;
   // Generated extension avoids rendering or suggesting execution of a supplied filename.
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
   try{const link=document.createElement('a');link.href=url;link.download=`original-${evidence.id}.${evidence.originalKind==='opaque_binary'?'bin':'txt'}`;link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
   setReceipt(`Verified original download prepared. SHA-256: ${evidence.digest}`);
  }catch(e){if(alive.current)setError((e as Error).message);}finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 return <div className="panel-body"><button className="secondary" disabled={busy} onClick={()=>void download()}>{busy?'Verifying original…':'Verify and download original'}</button><p className="small muted">The server records access. Exact bytes are checked before download. Binary originals use a .bin filename and remain quarantined; do not open untrusted files. This does not scan or approve the original.</p>{error&&<p role="alert">{error}</p>}{receipt&&<p role="status">{receipt}</p>}</div>;
}
