import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowUpRight, X, Search, ShieldCheck, LockKeyhole } from 'lucide-react';
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:string}) {return <span className={`badge ${tone}`}><i/>{children}</span>;}
export function Status({value}:{value:string}) {return <Badge tone={['Active','Accepted','Verified','Approved','Demo receipt'].includes(value)?'teal':['Scope review','Under review','In review','Queued','Unsupported'].includes(value)?'amber':value==='Rejected'?'red':'neutral'}>{value}</Badge>;}
export function SectionTitle({eyebrow,title,description,action}:{eyebrow:string;title:string;description?:string;action?:ReactNode}) {return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</div>;}
export function Panel({title,meta,children,className=''}:{title:string;meta?:ReactNode;children:ReactNode;className?:string}) {return <section className={`panel ${className}`}><div className="panel-heading"><h2>{title}</h2>{meta}</div>{children}</section>;}
export function Empty({title,children}:{title:string;children:ReactNode}) {return <div className="empty"><Search size={27}/><h3>{title}</h3><p>{children}</p></div>;}
export function Notice({children,restricted=false}:{children:ReactNode;restricted?:boolean}) {return <div className={`notice ${restricted?'restricted':''}`}>{restricted?<LockKeyhole size={16}/>:<ShieldCheck size={16}/>}<span>{children}</span></div>;}
export function Jump({children,onClick}:{children:ReactNode;onClick:()=>void}) {return <button className="text-button" onClick={onClick}>{children}<ArrowUpRight size={14}/></button>;}
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);const titleId=useId();
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return ()=>dialog?.close();},[]);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
