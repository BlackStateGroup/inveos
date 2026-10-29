import type {CitationReceipt} from './citationRequest';
import type {ReviewHistory} from './citationReview';

export type DocumentClaimRequest={id:string;citationDigest:string;correspondenceReviewId:string;correspondenceReviewDigest:string;text:string};
export type DocumentClaimDecisionRequest={id:string;claimDigest:string;accepted:boolean;reason:string};
export type DocumentClaim=DocumentClaimRequest&{format:string;context:CitationReceipt['citation']['context'];status:string;createdBy:string;createdAt:string;digest:string;correspondenceCurrent:boolean;decision:(DocumentClaimDecisionRequest&{format:string;context:CitationReceipt['citation']['context'];claimId:string;citationId:string;citationDigest:string;correspondenceReviewId:string;correspondenceReviewDigest:string;reviewedBy:string;reviewedAt:string;scope:string;digest:string})|null;finding:{id:string;text:string}|null};
export type DocumentClaimWorkspace={citationId:string;citationDigest:string;currentCorrespondenceReviewId:string|null;currentCorrespondenceDecision:string|null;claims:DocumentClaim[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
export async function verifyDocumentClaims(value:unknown,candidate:CitationReceipt,reviews:ReviewHistory):Promise<DocumentClaimWorkspace>{
 const fail=():never=>{throw new Error('Document-derived claim workspace could not be verified. Refresh before continuing.');},w=value as DocumentClaimWorkspace;
 const current=reviews.reviews.at(-1)??null;
 if(!w||w.citationId!==candidate.id||w.citationDigest!==candidate.citationDigest||w.currentCorrespondenceReviewId!==(current?.id??null)||w.currentCorrespondenceDecision!==(current?.decision??null)||!Array.isArray(w.claims)||w.claims.length>50)fail();
 const seen=new Set<string>();
 for(const c of w.claims){
  const correspondence=reviews.reviews.find(r=>r.id===c.correspondenceReviewId);
  if(!correspondence)throw new Error('Document-derived claim workspace could not be verified. Refresh before continuing.');
  if(!c||!uuid.test(c.id)||seen.has(c.id)||correspondence.decision!=='accepted'||c.citationDigest!==candidate.citationDigest||c.correspondenceReviewDigest!==correspondence.digest||typeof c.text!=='string'||!c.text.trim()||new TextEncoder().encode(c.text).length>8000||!uuid.test(c.createdBy)||!Number.isFinite(Date.parse(c.createdAt)))fail();
  const expected={format:'inveos_document_claim_v1',context:candidate.citation.context,id:c.id,citationId:candidate.id,citationDigest:candidate.citationDigest,correspondenceReviewId:correspondence.id,correspondenceReviewDigest:correspondence.digest,text:c.text,status:'proposed_interpretation',createdBy:c.createdBy,createdAt:c.createdAt};
  const {digest,correspondenceCurrent,decision,finding,...record}=c;if(JSON.stringify(record)!==JSON.stringify(expected)||digest!==await hash(expected)||correspondenceCurrent!==(current?.id===correspondence.id&&current.decision==='accepted'))fail();
  if(decision){
   if(!uuid.test(decision.id)||decision.claimDigest!==digest||decision.claimId!==c.id||decision.citationId!==candidate.id||decision.citationDigest!==candidate.citationDigest||decision.correspondenceReviewId!==correspondence.id||decision.correspondenceReviewDigest!==correspondence.digest||decision.reviewedBy===c.createdBy||!uuid.test(decision.reviewedBy)||!Number.isFinite(Date.parse(decision.reviewedAt))||typeof decision.accepted!=='boolean'||typeof decision.reason!=='string'||!decision.reason.trim())fail();
   const expectedDecision={format:'inveos_document_claim_decision_v1',context:candidate.citation.context,id:decision.id,claimId:c.id,claimDigest:digest,citationId:candidate.id,citationDigest:candidate.citationDigest,correspondenceReviewId:correspondence.id,correspondenceReviewDigest:correspondence.digest,accepted:decision.accepted,reason:decision.reason,reviewedBy:decision.reviewedBy,reviewedAt:decision.reviewedAt,scope:'interpretation_decision'};
   const {digest:decisionDigest,...decisionRecord}=decision;if(JSON.stringify(decisionRecord)!==JSON.stringify(expectedDecision)||decisionDigest!==await hash(expectedDecision))fail();
   if(decision.accepted?(finding?.id!==decision.id||finding.text!==c.text):finding!==null)fail();
  }else if(finding!==null)fail();
  seen.add(c.id);
 }
 return w;
}
