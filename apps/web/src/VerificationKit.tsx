import {useEffect,useRef,useState} from 'react';
import {readDisclosureBytes} from './recipientDiscovery';

export function VerificationKit(){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[digest,setDigest]=useState('');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function download(){
  controller.current?.abort();const request=new AbortController();controller.current=request;setBusy(true);setError('');setDigest('');
  try{
   const response=await fetch('/api/verification-kit',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(30000)])});
   if(!response.ok)throw new Error(response.status===401?'Sign in to download the verification kit.':'The complete verification kit is unavailable. Refresh and retry.');
   if(response.headers.get('content-type')?.split(';')[0]!=='application/zip')throw new Error('Verification kit format differs.');
   const expected=response.headers.get('X-INVEOS-Verifier-SHA256');if(!expected||!/^[a-f0-9]{64}$/.test(expected))throw new Error('Verification kit fingerprint is missing.');
   const bytes=await readDisclosureBytes(response,4*1024*1024),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(hash!==expected)throw new Error('Verification kit fingerprint differs.');if(request.signal.aborted)return;
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),link=document.createElement('a');link.href=url;link.download='inveos-verification-kit.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setDigest(hash);
  }catch(e){if(!request.signal.aborted)setError((e as Error).message);}finally{if(!request.signal.aborted)setBusy(false);}
 }
 return <section aria-label="Offline verification kit"><h3>Verify exported copies offline</h3><p className="small">Download the Python checkers and instructions for reports, document exhibits and PDF/DOCX copies. The kit contains no case data. Keep its fingerprint separately from the download.</p><button className="secondary" disabled={busy} onClick={()=>void download()}>{busy?'Preparing verification kit…':'Download offline verification kit'}</button>{error&&<p role="alert" className="form-error">{error}</p>}{digest&&<p className="small report-digest" role="status">Downloaded kit SHA-256: {digest}</p>}</section>;
}
