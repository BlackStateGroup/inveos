import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairRasterDocument} from '../../web/src/rasterOverlay.js';
import type {InspectedRaster} from '../../web/src/rasterInspection.js';
import type {InspectedDocument} from '../../web/src/documentInspection.js';
function fixture(){
 const document:InspectedDocument={caseId:'case-fiction',jobId:'extraction-fiction',evidenceId:'evidence-fiction',sourceDigest:'a'.repeat(64),authorityVersion:1,derivativeDigest:'b'.repeat(64),rawDigest:'c'.repeat(64),profileDigest:'d'.repeat(64),processedAt:'2026-10-29T00:00:00Z',pageCount:2,pages:[1,2].map(page=>({page,width:200,height:400})),pagesWithoutText:[1],references:[{itemRef:'#/texts/0',page:2,startByte:0,endByte:9,text:'FICTIONAL',bbox:{l:20,r:100,b:300,t:360,origin:'BOTTOMLEFT'}}]};
 const raster:InspectedRaster={job:{id:'raster-fiction',caseId:document.caseId,evidenceId:document.evidenceId,sourceDigest:document.sourceDigest,authorityVersion:1,kind:'pdf_raster_lab_v1',status:'succeeded'},processedAt:document.processedAt,derivativeDigest:'e'.repeat(64),profileDigest:'f'.repeat(64),pages:document.pages.map(p=>({...p,byteLength:100,digest:'a'.repeat(64)}))};return {document,raster};
}
test('overlay pairs exact original lineage and preserves page occurrence and byte offsets',()=>{const f=fixture(),before=structuredClone(f),refs=pairRasterDocument(f.raster,f.document);assert.equal(refs[0]!.page,2);assert.deepEqual(refs[0]!.region,{x:0.1,y:1-0.9,width:0.4,height:0.15});assert.equal(refs[0]!.startByte,0);assert.deepEqual(f,before);});
test('overlay denies foreign case, evidence, digest, authority and unsupported geometry',()=>{const f=fixture();for(const patch of [{caseId:'other'},{evidenceId:'other'},{sourceDigest:'f'.repeat(64)},{authorityVersion:2}])assert.throws(()=>pairRasterDocument(f.raster,{...f.document,...patch}));for(const size of [201,199.5,NaN]){const d=structuredClone(f.document);d.pages[0]!.width=size;assert.throws(()=>pairRasterDocument(f.raster,d));}assert.throws(()=>pairRasterDocument(f.raster,{...f.document,pages:f.document.pages.slice(1)}));});
