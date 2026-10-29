import type {makeDocumentDerivative} from './document-derivative.js';
import {sha256} from './text-derivative.js';
export type DocumentSelection={derivativeDigest:string;itemRef:string;startByte:number;endByte:number;quote:string};
/** Exact occurrence in extracted UTF-8, never offsets into the original PDF. */
export function documentCitation(output:ReturnType<typeof makeDocumentDerivative>,selection:DocumentSelection){
  const d=output.derivative,ref=d.references.find(r=>r.itemRef===selection.itemRef),bytes=Buffer.from(d.text);
  const fail=()=>{throw new Error('Invalid document citation selection');};
  if(selection.derivativeDigest!==output.digest||!ref||!Number.isInteger(selection.startByte)||!Number.isInteger(selection.endByte)||selection.startByte<ref.startByte||selection.endByte>ref.endByte||selection.endByte<=selection.startByte||typeof selection.quote!=='string'||Buffer.byteLength(selection.quote)>4096)fail();
  const decode=new TextDecoder('utf-8',{fatal:true});
  // Decode prefix too: a continuation-byte start must not silently become a new occurrence.
  decode.decode(bytes.subarray(0,selection.startByte));
  if(decode.decode(bytes.subarray(selection.startByte,selection.endByte))!==selection.quote)fail();
  const citation={format:'inveos_document_citation_candidate_v1',context:d.context,derivativeDigest:output.digest,rawDigest:output.rawDigest,profileDigest:d.profileDigest,status:'unreviewed_candidate',offsetBasis:d.offsetBasis,itemRef:ref!.itemRef,page:ref!.page,bbox:ref!.bbox,startByte:selection.startByte,endByte:selection.endByte,quote:selection.quote};
  const encoded=Buffer.from(JSON.stringify(citation));return {citation,bytes:encoded,digest:sha256(encoded)};
}
