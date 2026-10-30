/** Append-only human decisions. Extraction correspondence and interpretation are separate. */
import type {TikaCitationEntry,TikaReview,TikaClaim,TikaDecision,TikaSelection} from '@inveos/contracts';
import {tikaCitation,type makeTikaDerivative} from './tika-derivative.js';
import {transcriptHash} from './transcript-findings.js';
import {transcriptText} from './supplied-transcript.js';
export const tikaSeal=<T extends object>(record:T)=>({...record,digest:transcriptHash(record)});
const fail=():never=>{throw new Error('Invalid linked Tika review record');};
function actor(id:string,name:string,at:string){if(!/^[a-f0-9-]{36}$/.test(id)||!transcriptText(name,300)||new Date(at).toISOString()!==at)fail();}
function reason(value:string){if(!transcriptText(value,3000)||value.trim().length<10)fail();}
export function makeTikaEntry(output:ReturnType<typeof makeTikaDerivative>,id:string,selection:TikaSelection,authorId:string,authorName:string,recordedAt:string):TikaCitationEntry{
 actor(authorId,authorName,recordedAt);return tikaSeal({id,authorId,authorName,recordedAt,citation:tikaCitation(output,selection)});
}
export function makeTikaReview(entry:TikaCitationEntry,input:Pick<TikaReview,'id'|'decision'|'reason'|'originalCompared'>,previous:TikaReview|null,reviewerId:string,reviewerName:string,recordedAt:string):TikaReview{
 actor(reviewerId,reviewerName,recordedAt);reason(input.reason);if(reviewerId===entry.authorId||!['accepted','rejected'].includes(input.decision)||typeof input.originalCompared!=='boolean'||input.decision==='accepted'&&!input.originalCompared||(previous?.sequence??0)>=20||recordedAt<(previous?.recordedAt??entry.recordedAt))fail();
 return tikaSeal({id:input.id,citationId:entry.id,citationDigest:entry.digest,sequence:(previous?.sequence??0)+1,previousDigest:previous?.digest??null,decision:input.decision,reason:input.reason,originalCompared:input.originalCompared,reviewerId,reviewerName,recordedAt,scope:'extraction_correspondence_only' as const});
}
export function makeTikaClaim(entry:TikaCitationEntry,review:TikaReview,input:Pick<TikaClaim,'id'|'text'>,authorId:string,authorName:string,recordedAt:string):TikaClaim{
 actor(authorId,authorName,recordedAt);if(!transcriptText(input.text,6000)||review.citationDigest!==entry.digest||review.citationId!==entry.id||review.decision!=='accepted'||recordedAt<review.recordedAt)fail();
 return tikaSeal({id:input.id,citationId:entry.id,citationDigest:entry.digest,correspondenceDigest:review.digest,text:input.text,authorId,authorName,recordedAt,state:'proposed_interpretation' as const});
}
export function makeTikaDecision(claim:TikaClaim,input:Pick<TikaDecision,'id'|'accepted'|'reason'>,reviewerId:string,reviewerName:string,recordedAt:string):TikaDecision{
 actor(reviewerId,reviewerName,recordedAt);reason(input.reason);if(reviewerId===claim.authorId||typeof input.accepted!=='boolean'||recordedAt<claim.recordedAt)fail();
 return tikaSeal({id:input.id,claimId:claim.id,claimDigest:claim.digest,accepted:input.accepted,reason:input.reason,reviewerId,reviewerName,recordedAt,scope:'interpretation_only' as const});
}
