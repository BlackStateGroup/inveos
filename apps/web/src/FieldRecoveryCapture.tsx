import {useState} from 'react';
import type {FieldContext} from '@inveos/contracts';
import type {LocalCapture} from './fieldVault';
export function FieldRecoveryCapture({item,contexts,busy,connected,request,refresh,receipt,original}:{item:LocalCapture;contexts:FieldContext[];busy:boolean;connected:boolean;request:(context:FieldContext,reason:string)=>void;refresh:()=>void;receipt:()=>void;original:()=>void}){
 const [reason,setReason]=useState(''),[confirm,setConfirm]=useState(false),target=contexts.find(c=>c.caseId===item.context.caseId&&c.tenantId===item.context.tenantId&&c.userId===item.context.userId&&c.grant?.current);
 return <details className="field-recovery"><summary>Sync history and recovery</summary>
  <p className="small">The encrypted original and its frozen manifest are retained. A timeout does not prove failure. Check the exact receipt before requesting recovery.</p>
  <div className="work-record-actions"><button disabled={busy||!connected} onClick={receipt}>Check exact server receipt</button><button disabled={busy} onClick={original}>Save original bytes locally</button></div>
  <ol>{(item.attempts??[]).map((a,i)=><li key={i}><strong>{a.outcome.replaceAll('_',' ')}</strong> · device time {a.at}<br/>{a.detail}</li>)}</ol>
  {!!item.recoveryHistory?.length&&<details><summary>Earlier retained recovery requests</summary>{item.recoveryHistory.map(r=><p key={r.id}>{r.id} · {r.response?.review?.decision??'unconfirmed or pending'}<br/>{r.reason}</p>)}</details>}
  {item.recovery&&<section><p>Recovery {item.recovery.id} · {item.recovery.response?.review?.decision??(item.recovery.response?'pending independent review':'request response unconfirmed')}</p><p>{item.recovery.reason}</p><button disabled={busy||!connected} onClick={refresh}>Refresh or recover review receipt</button></section>}
  {item.state!=='delivered'&&<form className="work-form" onSubmit={e=>{e.preventDefault();if(target&&confirm)request(target,reason);}}><fieldset disabled={busy||!connected||!target}>
   <p className="small">{target?`Propose current authority v${target.authority.version}, device ${target.device.id} v${target.device.version}, grant v${target.grant?.version}.`:'Save current scope first. A lost/revoked identity needs a replacement device. The case and account must match the retained capture.'}</p>
   {target&&<p><strong>Proposed permitted scope:</strong> {target.authority.scope}<br/><strong>Minimisation:</strong> {target.authority.minimisation}</p>}
   <label className="form-label">Recovery reason<textarea required minLength={10} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <label className="checkbox-row"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} required/>I inspected the original and request independent review under this current scope.</label><button className="secondary">Request independent recovery</button>
  </fieldset></form>}
 </details>;
}
