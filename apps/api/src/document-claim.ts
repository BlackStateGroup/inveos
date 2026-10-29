import type {documentCitation} from './document-citation.js';
import type {documentReview} from './document-review.js';
import {sha256} from './text-derivative.js';

export type ReviewedCitation=ReturnType<typeof documentReview>['record']&{digest:string};
export type DocumentClaimInput={id:string;citationDigest:string;correspondenceReviewId:string;correspondenceReviewDigest:string;text:string};
export type DocumentClaimDecisionInput={id:string;claimDigest:string;accepted:boolean;reason:string};

/** Proposed interpretation of reviewed extraction correspondence; never a finding by itself. */
export function documentClaim(citationId:string,candidate:ReturnType<typeof documentCitation>,review:ReviewedCitation,input:DocumentClaimInput,author:string,createdAt:string){
 if(review.citationId!==citationId||review.citationDigest!==candidate.digest||review.digest!==input.correspondenceReviewDigest||review.id!==input.correspondenceReviewId||review.decision!=='accepted'||input.citationDigest!==candidate.digest||typeof input.text!=='string'||!input.text.trim()||Buffer.byteLength(input.text)>8000||!Number.isFinite(Date.parse(createdAt)))throw new Error('Invalid derived claim');
 const record={format:'inveos_document_claim_v1',context:candidate.citation.context,id:input.id,citationId,citationDigest:candidate.digest,correspondenceReviewId:review.id,correspondenceReviewDigest:review.digest,text:input.text,status:'proposed_interpretation',createdBy:author,createdAt};
 const bytes=Buffer.from(JSON.stringify(record));return {record,bytes,digest:sha256(bytes)};
}

/** Independent decision on interpretation; correspondence review remains a separate record. */
export function documentClaimDecision(claim:ReturnType<typeof documentClaim>,input:DocumentClaimDecisionInput,reviewer:string,reviewedAt:string){
 if(input.claimDigest!==claim.digest||typeof input.accepted!=='boolean'||typeof input.reason!=='string'||!input.reason.trim()||Buffer.byteLength(input.reason)>6000||reviewer===claim.record.createdBy||!Number.isFinite(Date.parse(reviewedAt)))throw new Error('Invalid derived claim decision');
 const record={format:'inveos_document_claim_decision_v1',context:claim.record.context,id:input.id,claimId:claim.record.id,claimDigest:claim.digest,citationId:claim.record.citationId,citationDigest:claim.record.citationDigest,correspondenceReviewId:claim.record.correspondenceReviewId,correspondenceReviewDigest:claim.record.correspondenceReviewDigest,accepted:input.accepted,reason:input.reason,reviewedBy:reviewer,reviewedAt,scope:'interpretation_decision'};
 const bytes=Buffer.from(JSON.stringify(record));return {record,bytes,digest:sha256(bytes)};
}
