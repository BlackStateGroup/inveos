import type {AnalysisMode,AnalysisSource,AnalysisSuggestion,ChronologySource,ReviewedSourceFinding} from '@inveos/contracts';
import {transcriptHash as hash} from './transcript-findings.js';
const stop=new Set('a an and are as at be been but by did do does for from had has have he her him his i in is it its of on or our she that the their them there these they this those to was we were what when where which who why will with you your'.split(' '));
const negation=new Set(['not','no','never','without','neither','nor']);
const terms=(text:string)=>[...new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}]{2,40}/gu)??[])].filter(word=>!stop.has(word));
export function analysisSource(reference:ChronologySource,f:ReviewedSourceFinding):AnalysisSource{
 let quote:string,location:string;
 const original='kind' in f&&f.kind==='reviewed_transcript'?f.claim.source:f.source;
 if(!('kind' in f)){quote=f.source.quote;location=`Original UTF-8 bytes ${f.source.startByte}–${f.source.endByte}`;}
 else if(f.kind==='derived_document'){quote=f.reference.quote;location=`Extraction ${f.extraction.jobId}; page ${f.reference.page}; ${f.reference.itemRef}; extracted UTF-8 bytes ${f.reference.startByte}–${f.reference.endByte}`;}
 else if(f.kind==='reviewed_transcript'){quote=f.claim.reference.quote;location=`Supplied transcript ${f.claim.transcript.id}; segment ${f.claim.transcript.segmentId}; correction v${f.claim.transcript.version}; selected UTF-8 bytes ${f.claim.reference.startByte}–${f.claim.reference.endByte}; declared ${f.claim.reference.startMs}–${f.claim.reference.endMs} ms`;}
 else{quote=f.claim.reference.quote;location=`Speech job ${f.claim.reference.jobId}; segment ${f.claim.reference.segmentIndex+1}; correction v${f.claim.reference.version}; selected UTF-8 bytes ${f.claim.reference.startByte}–${f.claim.reference.endByte}; account ${f.claim.reference.account.startMs}–${f.claim.reference.account.endMs} ms`;}
 return {reference,fingerprint:hash(f),statement:f.text,quote,location,original:{id:original.id,filename:original.filename,sha256:original.sha256,sourceTime:original.sourceTime,receivedTime:original.receivedTime}};
}
const matches=(quote:string,regex:RegExp)=>[...new Set([...quote.matchAll(regex)].map(m=>m[0]))].sort();
const numbers=(quote:string)=>matches(quote,/(?:\b(?:GBP|EUR|USD)\s*|[£€$]\s*)\d+(?:[,.]\d+)*/g);
const dates=(quote:string)=>matches(quote,/\b\d{4}-\d{2}-\d{2}\b/g);
const currency=(s:string)=>s.startsWith('£')||s.startsWith('GBP')?'GBP':s.startsWith('€')||s.startsWith('EUR')?'EUR':'USD';
export function analyseSources(sources:AnalysisSource[],mode:AnalysisMode,question:string){
 const wanted=terms(question),passages=sources.map((s,source)=>({source,matchedTerms:wanted.filter(t=>terms(s.quote+' '+s.statement).includes(t))})).filter(p=>mode!=='question'||p.matchedTerms.length>0).sort((a,b)=>b.matchedTerms.length-a.matchedTerms.length||a.source-b.source);
 const suggestions:AnalysisSuggestion[]=[];
 if(mode==='comparison')for(let a=0;a<sources.length;a++)for(let b=a+1;b<sources.length;b++){
  // Text overlap is a retrieval hint, never an entity match or contradiction verdict.
  const left=sources[a]!,right=sources[b]!,lt=terms(left.quote),rt=terms(right.quote),common=lt.filter(t=>!negation.has(t)&&rt.includes(t));
  if(common.length<3||left.original.id===right.original.id)continue;
  const add=(kind:AnalysisSuggestion['kind'],observed:[string[],string[]],explanation:string,check:string)=>{if(suggestions.length<40)suggestions.push({kind,sources:[a,b],observed,explanation,check});};
  const ln=numbers(left.quote),rn=numbers(right.quote);
  for(const unit of ['GBP','EUR','USD']){const l=ln.filter(v=>currency(v)===unit),r=rn.filter(v=>currency(v)===unit);if(l.length&&r.length&&JSON.stringify(l)!==JSON.stringify(r))add('amount_difference',[l,r],`These passages share wording but show different ${unit} literals. Formatting, period, tax or subject may explain the difference.`, 'Check that both amounts refer to the same subject, period and basis; preserve alternative explanations.');}
  const ld=dates(left.quote),rd=dates(right.quote);if(ld.length&&rd.length&&JSON.stringify(ld)!==JSON.stringify(rd))add('date_difference',[ld,rd],'These passages share wording but contain different ISO-shaped dates. No common event or valid calendar date is inferred.','Check what each date describes and retain its stated precision and timezone.');
  const lneg=lt.filter(t=>negation.has(t)),rneg=rt.filter(t=>negation.has(t));if(Boolean(lneg.length)!==Boolean(rneg.length))add('wording_difference',[lneg,rneg],'One passage contains a recognised negation word. Its scope and factual meaning are unverified.','Compare the full accounts; determine whether the negation concerns the same proposition.');
 }
 return {passages,suggestions,limitations:'Deterministic passage retrieval and literal comparison only; no language model, semantic answer, identity match, truth assessment or complete contradiction detection. Source assertions can be wrong. Only selected reviewed passages were considered; omitted context and unselected material may change the interpretation. Suggestions cannot become findings or client releases automatically.'};
}
