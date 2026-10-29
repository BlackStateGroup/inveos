import {useEffect,useState} from 'react';
import {type InspectedRaster,verifyRasterPage} from './rasterInspection';
export function RasterInspection({raster}:{raster:InspectedRaster}){
  const [pageNumber,setPage]=useState(1),[image,setImage]=useState<{page:number;url:string}|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const page=raster.pages[pageNumber-1]!;
  useEffect(()=>{const controller=new AbortController();let url:string|undefined;
    setImage(null);setError('');
    void fetch(`/api/cases/${raster.job.caseId}/integrity-jobs/${raster.job.id}/raster-pages/${page.page}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(r=>verifyRasterPage(r,page)).then(blob=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setImage({page:page.page,url});})
      .catch(()=>{if(!controller.signal.aborted)setError('Page unavailable or integrity verification failed. Reload to retry.');});
    return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
  },[raster,page,revision]);
  return <section aria-label="Verified unreviewed raster pages"><h3>Unreviewed page images</h3>
    <p>These images are derivatives, not originals or approved findings. Forms and annotations are omitted; images are greyscale and visual fidelity is unapproved. Compare the original separately.</p>
    <p>Evidence {raster.job.evidenceId} · authority version {raster.job.authorityVersion} · processed {raster.processedAt}</p>
    <p>Original SHA-256: {raster.job.sourceDigest}</p><p>Manifest SHA-256: {raster.derivativeDigest}</p>
    <label>Image page<select value={pageNumber} onChange={e=>{setImage(null);setError('');setPage(Number(e.target.value));}}>{raster.pages.map(p=><option key={p.page} value={p.page}>Page {p.page}</option>)}</select></label>
    <button className="secondary" onClick={()=>{setImage(null);setError('');setRevision(r=>r+1);}}>Reload verified page</button>
    <p>Page {page.page} · {page.width} × {page.height} pixels · SHA-256 {page.digest}</p>
    {error?<p role="alert">{error}</p>:image?.page===pageNumber?<img src={image.url} alt={`Unreviewed rendered page ${pageNumber}`} style={{display:'block',maxWidth:'100%',width:612,height:'auto'}} onLoad={e=>{if(e.currentTarget.naturalWidth!==page.width||e.currentTarget.naturalHeight!==page.height){setImage(null);setError('Decoded page dimensions do not match the verified manifest.');}}} onError={()=>{setImage(null);setError('Page image could not be decoded.');}}/>:<p role="status">Verifying page bytes…</p>}
  </section>;
}
