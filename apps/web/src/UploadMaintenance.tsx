import {useEffect,useRef,useState} from 'react';
import {Panel,Notice} from './ui';
type PendingUpload={id:string;byteLength:number;authorityVersion:number;expiresAt:string;owned:boolean;expired:boolean};
type Listing={canManage:boolean;items:PendingUpload[]};
/** Pending staging only. Successful cancellation never means deletion of received evidence. */
export function UploadMaintenance({caseId,csrf,transferring}:{caseId:string;csrf:string;transferring:boolean}){
 const [listing,setListing]=useState<Listing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(''),[reason,setReason]=useState('');
 const alive=useRef(true),locked=useRef(false),controller=useRef<AbortController|null>(null);
 const base=`/api/cases/${caseId}/uploads`;
 async function send(path:string,payload?:unknown){
  const response=await fetch(path,{method:payload===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},signal:AbortSignal.any([controller.current!.signal,AbortSignal.timeout(30000)]),...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  const body=await response.json();if(!response.ok)throw new Error(body.error||'Upload maintenance failed.');return body;
 }
 async function run(action?:{id:string;reviewer:boolean}|'expire'){
  if(locked.current||transferring)return;locked.current=true;controller.current=new AbortController();setBusy(true);setError('');setReceipt('');
  try{
   if(action==='expire'){
    const result=await send(base+'/expire',{limit:10});
    if(alive.current)setReceipt(`${result.expired.length} expired reservations closed. Completed originals are retained.`);
   }else if(action){
    const result=await send(base+'/'+action.id+(action.reviewer?'/reviewer-cancel':'/cancel'),action.reviewer?{reason}:{});
    if(result.status!=='cancelled')throw new Error('Reservation already completed. Refresh and inspect the original receipt.');
    if(alive.current)setReceipt(`Reservation ${action.id} cancelled. Staging removed; history retained.`);
   }
   const value=await send(base) as Listing;if(alive.current)setListing(value);
  }catch(e){if(alive.current)setError((e as Error).message);}finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 // Parent keys this panel by case and sign-in; abort prevents old responses crossing contexts.
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 return <Panel title="Pending uploads"><div className="panel-body"><Notice>Refresh to inspect pending staging. Cancelling removes only unfinished transfer bytes. Keep your local file. Completed originals and audit history are retained.</Notice>
  <button className="secondary" disabled={busy||transferring} onClick={()=>void run()}>Refresh pending uploads</button>
  {listing?.canManage&&<><button className="secondary" disabled={busy||transferring} onClick={()=>void run('expire')}>Close expired reservations</button><label className="form-label">Reason for cancelling another uploader’s reservation<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} disabled={busy||transferring}/></label></>}
  {listing&&<p>{listing.items.length===0?'No pending uploads visible.':listing.canManage?'Pending uploads for this case (maximum ten).':'Your pending uploads (maximum ten).'}</p>}
  {listing?.items.map(item=><div key={item.id}><p><strong>{item.id}</strong> · {item.byteLength} reserved bytes · authority {item.authorityVersion} · {item.expired?'Expired':'Expires'} {item.expiresAt} · {item.owned?'Your upload':'Another uploader'}</p><button className="secondary" disabled={busy||transferring||(!item.owned&&reason.trim().length<10)} onClick={()=>void run({id:item.id,reviewer:!item.owned})}>Cancel this pending upload</button></div>)}
  {busy&&<p role="status">Updating pending uploads…</p>}{error&&<p role="alert">{error} Refresh before retrying an unconfirmed action.</p>}{receipt&&<p role="status">{receipt}</p>}
  <p>Cancellation does not clear this tab’s unconfirmed intake key. After cancelling, use “Confirm cancellation and clear this retry” above to check the terminal receipt before starting a replacement transfer.</p>
 </div></Panel>;
}
