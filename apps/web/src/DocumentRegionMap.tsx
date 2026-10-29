import {useState} from 'react';
import type {InspectedDocument} from './documentInspection';

import {displayRegion} from './documentRegion';
export function DocumentRegionMap({document}:{document:InspectedDocument}){
  const [pageNumber,setPage]=useState(1),[selected,setSelected]=useState<string|null>(null);
  const page=document.pages[pageNumber-1]!,refs=document.references.filter(r=>r.page===pageNumber);
  const active=refs.find(r=>r.itemRef===selected);
  return <section aria-label="Extracted region map">
    <h4>Extracted region map</h4>
    <p>This outline shows extraction coordinates only. It is not an original PDF image and cannot establish visual accuracy or approve a finding.</p>
    <label>Map page<select value={pageNumber} onChange={e=>{setPage(Number(e.target.value));setSelected(null);}}>
      {document.pages.map(p=><option key={p.page} value={p.page}>Page {p.page}</option>)}</select></label>
    <svg role="img" aria-label={`Extraction outline for page ${pageNumber}`} viewBox="0 0 1 1" preserveAspectRatio="none"
      style={{display:'block',width:'100%',maxWidth:400,aspectRatio:`${page.width}/${page.height}`,border:'1px solid currentColor',background:'#fff'}}>
      <title>Extracted regions only; original page is not displayed</title>
      {refs.map(ref=><rect key={ref.itemRef} {...displayRegion(page,ref.bbox)} fill={selected===ref.itemRef?'#b45309':'#2563eb'} fillOpacity={selected===ref.itemRef?0.6:0.2} stroke="#172554" strokeWidth={0.002}/>)}
    </svg>
    <p role="status">{refs.length?`${refs.length} extracted passages on page ${pageNumber}.`:'No extracted text on this page. Compare the original separately.'}</p>
    <div aria-label="Select mapped passage">{refs.map((ref,i)=><button type="button" className="secondary" key={ref.itemRef} aria-pressed={selected===ref.itemRef} onClick={()=>setSelected(ref.itemRef)}>Highlight page {pageNumber} passage {i+1}</button>)}</div>
    {active&&<div aria-live="polite"><p>Selected {active.itemRef} · extracted UTF-8 bytes [{active.startByte}, {active.endByte})</p><pre className="source-excerpt">{active.text}</pre></div>}
  </section>;
}
