import type {documentCitation} from './document-citation.js';
import {sha256} from './text-derivative.js';
export type DocumentReviewInput={id:string;previousReviewId:string|null;citationDigest:string;decision:'accepted'|'rejected';reason:string;originalCompared:boolean};
export type ReviewPredecessor={id:string;sequence:number;digest:string};
/** A source-comparison decision, not approval of a claim's interpretation or truth. */
export function documentReview(citationId:string,candidate:ReturnType<typeof documentCitation>,input:DocumentReviewInput,reviewer:string,reviewedAt:string,previous:ReviewPredecessor|null){
 if(input.citationDigest!==candidate.digest||input.previousReviewId!==(previous?.id??null)||!['accepted','rejected'].includes(input.decision)||typeof input.reason!=='string'||!input.reason.trim()||Buffer.byteLength(input.reason)>4096||typeof input.originalCompared!=='boolean'||input.decision==='accepted'&&!input.originalCompared||!Number.isFinite(Date.parse(reviewedAt)))throw new Error('Invalid citation review');
 const record={format:'inveos_document_citation_review_v1',context:candidate.citation.context,citationId,citationDigest:candidate.digest,id:input.id,sequence:(previous?.sequence??0)+1,previousReviewId:previous?.id??null,previousReviewDigest:previous?.digest??null,decision:input.decision,reason:input.reason,originalCompared:input.originalCompared,reviewedBy:reviewer,reviewedAt,scope:'extraction_correspondence_not_finding'};
 if(record.sequence>100)throw new Error('Review history limit reached');
 const bytes=Buffer.from(JSON.stringify(record));return {record,bytes,digest:sha256(bytes)};
}
