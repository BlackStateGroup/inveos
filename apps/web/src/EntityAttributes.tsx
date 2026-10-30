import {useState} from 'react';
import {entityAttributeLabels,type EntityAttributeInput,type ChronologySource} from '@inveos/contracts';
type Candidate=ChronologySource&{text:string};
export function EntityAttributes({initial,candidates}:{initial:EntityAttributeInput[];candidates:Candidate[]}){
 const [rows,setRows]=useState(initial.map(a=>({...a,key:crypto.randomUUID()})));
 return <fieldset><legend>Source-linked identity attributes</legend><p className="small">These are working interpretations of reviewed sources. Shared names or identifiers do not establish identity. Keep uncertainty in the entity account.</p>
 {rows.map((row,index)=><div className="work-form-grid" key={row.key}>
 <label className="form-label">Attribute {index+1}<select name="attributeProperty" defaultValue={row.property}>{Object.entries(entityAttributeLabels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
 <label className="form-label">Value {index+1}<input name="attributeValue" required maxLength={300} defaultValue={row.value}/></label>
 <label className="form-label">Reviewed source {index+1}<select name="attributeSource" required defaultValue={row.source.findingId?row.source.kind+':'+row.source.findingId:''}><option value="">Choose a source finding</option>{candidates.map(c=><option key={c.kind+c.findingId} value={c.kind+':'+c.findingId}>{c.text}</option>)}{row.source.findingId&&!candidates.some(c=>c.kind===row.source.kind&&c.findingId===row.source.findingId)&&<option value={row.source.kind+':'+row.source.findingId}>Retained source — current verification required</option>}</select></label>
 <button type="button" className="text-button" onClick={()=>setRows(current=>current.filter(r=>r.key!==row.key))}>Remove attribute {index+1} from this revision</button>
 </div>)}
 <button type="button" className="secondary" disabled={rows.length>=20} onClick={()=>setRows(current=>[...current,{key:crypto.randomUUID(),property:'alias',value:'',source:{kind:'text_finding',findingId:''}}])}>Add identity attribute</button>
 </fieldset>;
}
