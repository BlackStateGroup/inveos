import type {CitationReceipt} from './citationRequest';
export type ReviewRequest={id:string;previousReviewId:string|null;citationDigest:string;decision:'accepted'|'rejected';reason:string;originalCompared:boolean};
export type CitationReview=ReviewRequest&{format:string;context:CitationReceipt['citation']['context'];citationId:string;sequence:number;previousReviewDigest:string|null;reviewedBy:string;reviewedAt:string;scope:string;digest:string};
export type ReviewHistory={citationId:string;citationDigest:string;currentReviewId:string|null;reviews:CitationReview[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function verifyReviewHistory(value:unknown,candidate:CitationReceipt):Promise<ReviewHistory>{
 const fail=():never=>{throw new Error('Citation review history could not be verified. Refresh before continuing.');};
 const h=value as ReviewHistory;if(!h||h.citationId!==candidate.id||h.citationDigest!==candidate.citationDigest||!Array.isArray(h.reviews)||h.reviews.length>100)fail();
 let previous:CitationReview|null=null;const ids=new Set<string>();
 for(const r of h.reviews){
  if(!r||!uuid.test(r.id)||ids.has(r.id)||!uuid.test(r.reviewedBy)||r.reviewedBy===candidate.createdBy||typeof r.reviewedAt!=='string'||!Number.isFinite(Date.parse(r.reviewedAt))||!['accepted','rejected'].includes(r.decision)||typeof r.reason!=='string'||!r.reason.trim()||new TextEncoder().encode(r.reason).length>4096||typeof r.originalCompared!=='boolean'||r.decision==='accepted'&&!r.originalCompared)fail();
  const expected={format:'inveos_document_citation_review_v1',context:candidate.citation.context,citationId:candidate.id,citationDigest:candidate.citationDigest,id:r.id,sequence:(previous?.sequence??0)+1,previousReviewId:previous?.id??null,previousReviewDigest:previous?.digest??null,decision:r.decision,reason:r.reason,originalCompared:r.originalCompared,reviewedBy:r.reviewedBy,reviewedAt:r.reviewedAt,scope:'extraction_correspondence_not_finding'};
  const {digest,...record}=r;if(JSON.stringify(record)!==JSON.stringify(expected))fail();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(expected)))),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==hash)fail();
  previous=r;ids.add(r.id);
 }
 if(h.currentReviewId!==(previous?.id??null))fail();return h;
}
