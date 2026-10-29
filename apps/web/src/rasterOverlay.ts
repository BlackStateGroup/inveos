import type {InspectedDocument} from './documentInspection';
import type {InspectedRaster} from './rasterInspection';
import {displayRegion} from './documentRegion';
/** Both inputs must first pass their existing receipt verifiers. No implicit "latest" pairing. */
export function pairRasterDocument(raster:InspectedRaster,document:InspectedDocument){
  if(raster.job.caseId!==document.caseId||raster.job.evidenceId!==document.evidenceId||raster.job.sourceDigest!==document.sourceDigest||raster.job.authorityVersion!==document.authorityVersion||raster.pages.length!==document.pages.length)throw new Error('Extraction and raster lineage do not match.');
  for(const [i,page] of raster.pages.entries()){
    const source=document.pages[i]!;
    // Fractional page rounding can shift overlays; reject until its transform is qualified.
    if(source.page!==page.page||source.width!==page.width||source.height!==page.height)throw new Error('Page geometry is not qualified for overlay.');
  }
  return document.references.map(ref=>({...ref,region:displayRegion(document.pages[ref.page-1]!,ref.bbox)}));
}
