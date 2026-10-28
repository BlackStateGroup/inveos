import {useEffect,useRef,useState} from 'react';
export function OtherSessions(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const alive=useRef(true),locked=useRef(false),controller=useRef<AbortController|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 async function end(){
  if(locked.current)return;locked.current=true;setBusy(true);setMessage('');setError('');const request=new AbortController();controller.current=request;
  try{
   const csrf=document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('inveos_csrf='))?.slice(12);if(!csrf)throw new Error('Sign in again to manage sessions.');
   const r=await fetch('/api/session/end-others',{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(30000)]),headers:{'Content-Type':'application/json','X-CSRF-Token':decodeURIComponent(csrf)},body:'{}'});
   if(!r.ok)throw new Error('Session changes not confirmed. Retry with a valid session; an earlier request may have committed.');
   const value=await r.json();if(!Number.isInteger(value.revokedCount)||value.revokedCount<0||value.revokedCount>100||typeof value.moreRemaining!=='boolean')throw new Error('Invalid session receipt.');
   if(alive.current)setMessage(`${value.revokedCount} other sessions ended. This session remains active.${value.moreRemaining?' More remain; repeat to end the next batch.':''}`);
  }catch(e){if(alive.current)setError((e as Error).message);}finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 return <section aria-label="Other sessions"><p>End up to 100 other sessions for your account in this workspace. This does not retract downloads or stop requests already authorised. The shared synthetic reviewer account may be used in other lab windows.</p><button className="secondary" disabled={busy} onClick={()=>void end()}>{busy?'Ending sessions…':'End other sessions'}</button>{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
