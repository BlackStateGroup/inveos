import type {Reference} from './documentInspection';
/** Convert PDF coordinates to a top-left, unit-square display without changing stored provenance. */
export function displayRegion(page:{width:number;height:number},box:Reference['bbox']){
  const {width,height}=page,{l,r,b,t,origin}=box;
  if(![width,height,l,r,b,t].every(Number.isFinite)||width<=0||height<=0||l<0||r<=l||r>width||
    Math.min(b,t)<0||Math.max(b,t)>height||!['TOPLEFT','BOTTOMLEFT'].includes(origin)||
    (origin==='TOPLEFT'?t>=b:b>=t))throw new Error('Invalid page region');
  return {x:l/width,y:origin==='TOPLEFT'?t/height:1-t/height,width:(r-l)/width,height:Math.abs(t-b)/height};
}
