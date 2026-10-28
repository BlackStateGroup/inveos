import {useEffect,useRef,useState} from 'react';
import {verifyRevisionDownload} from './reportDownload';
import {readDisclosurePage,readDisclosureBytes,type DisclosureItem} from './recipientDiscovery';

/** Separate client surface: never loads the internal workspace or starts a demo reviewer session. */
export default function RecipientPortal(){
 const [items,setItems]=useState<DisclosureItem[]>([]),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function load(before?:string){
  controller.current?.abort();const request=new AbortController();controller.current=request;setBusy(true);setError('');
  try{const response=await fetch('/api/portal/disclosures?limit=25'+(before?'&before='+encodeURIComponent(before):''),{credentials:'same-origin',cache:'no-store',signal:request.signal});
   if(!response.ok)throw new Error(response.status===401?'Sign in with an authorised client session to view disclosures.':response.status===403?'This session is not a client recipient.':'Disclosure list unavailable. Refresh to try again.');
   const page=readDisclosurePage(await response.json());if(request.signal.aborted)return;setItems(page.items);setNext(page.nextBefore);setLoaded(true);
  }catch(e){if(!request.signal.aborted){setItems([]);setNext(null);setLoaded(false);setError((e as Error).message);}}finally{if(!request.signal.aborted)setBusy(false);}
 }
 async function download(item:DisclosureItem){
  controller.current?.abort();const request=new AbortController();controller.current=request;setBusy(true);setError('');
  try{const response=await fetch('/api/portal/disclosures/'+item.id,{credentials:'same-origin',cache:'no-store',signal:request.signal});
   if(!response.ok)throw new Error('Download denied or unavailable. Refresh the disclosure list; access may have changed.');
   const bytes=await readDisclosureBytes(response);await verifyRevisionDownload(bytes,item.sha256,response.headers.get('X-INVEOS-Report-SHA256'));if(request.signal.aborted)return;
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='disclosure-'+item.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){if(!request.signal.aborted)setError((e as Error).message);}finally{if(!request.signal.aborted)setBusy(false);}
 }
 return <main style={{maxWidth:850,margin:'40px auto',padding:24}}><h1>INVEOS · Client disclosures</h1><p>Synthetic lab. This separate surface requires an existing authorised client session. Client sign-in and invitations are not yet available.</p><p>Only explicitly granted snapshots appear here. A snapshot may include original exhibits and internal context approved for full disclosure. Access can expire or be withdrawn; protect any downloaded copy.</p><button className="primary" disabled={busy} onClick={()=>void load()}>{busy?'Working…':'Refresh disclosures'}</button>{error&&<p role="alert">{error}</p>}{loaded&&items.length===0&&<p role="status">No currently available disclosures.</p>}<ul>{items.map(item=><li key={item.id} style={{margin:'24px 0'}}><strong>Disclosure {item.id}</strong><p>Revision {item.revisionId}<br/>Granted {item.createdAt}<br/>Expires {item.expiresAt}</p><p style={{overflowWrap:'anywhere'}}>SHA-256: {item.sha256}</p><button className="secondary" disabled={busy} onClick={()=>void download(item)}>Verify and download snapshot</button></li>)}</ul>{next&&<button className="secondary" disabled={busy} onClick={()=>void load(next)}>Older disclosures</button>}<p>Downloads are checked against the listed fingerprint. This establishes byte consistency, not factual truth, legal clearance or a signed final report. Listing alone does not verify a snapshot.</p></main>;
}
