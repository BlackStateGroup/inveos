import {createHash} from 'node:crypto';
import type {CompositionFindingKind,CompositionChoice,CompositionPayload,ReportDraft} from '@inveos/contracts';
export const compositionHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function compositionChoices(report:ReportDraft):CompositionChoice[]{
 const groups=[['text',report.findings],['document',report.documentFindings??[]],['transcript',report.transcriptFindings??[]],['speech',report.speechFindings??[]]] as const;
 return groups.flatMap(([kind,findings])=>findings.map(f=>{
  const source='kind' in f&&f.kind==='reviewed_transcript'?f.claim.source:f.source;
  // Explicit, string-only identity profile. Full citation/original verification remains in buildReport.
  return {kind,id:f.id,text:f.text,reviewer:f.reviewer,reviewedAt:f.reviewedAt,sha256:compositionHash(['inveos_composition_finding_v1',kind,f.id,f.text,f.reviewer,f.reviewedAt,source.id,source.sha256])};
 }));
}
export function orderedCompositionPayload(p:CompositionPayload):CompositionPayload{
 return {format:p.format,caseId:p.caseId,id:p.id,version:p.version,state:p.state,outline:{name:p.outline.name,scope:p.outline.scope,method:p.outline.method,limitations:p.outline.limitations,sections:p.outline.sections.map(s=>({id:s.id,title:s.title,findings:s.findings.map(f=>({kind:f.kind,id:f.id,sha256:f.sha256}))}))},reason:p.reason};
}
export function compositionDigest(p:CompositionPayload){return compositionHash(orderedCompositionPayload(p));}
export function compositionIds(p:CompositionPayload,kind:CompositionFindingKind){return p.outline.sections.flatMap(s=>s.findings.filter(f=>f.kind===kind).map(f=>f.id));}
export function verifyCompositionSelection(report:ReportDraft,p:CompositionPayload){
 const choices=compositionChoices(report),selected=p.outline.sections.flatMap(s=>s.findings);
 if(!selected.length||selected.length!==choices.length||new Set(selected.map(f=>f.id)).size!==selected.length||selected.some(f=>!choices.some(c=>c.kind===f.kind&&c.id===f.id&&c.sha256===f.sha256)))throw new Error('Composition selection no longer matches the exact reviewed findings. Refresh selected receipts and request a new outline review.');
}
export function verifyFrozenComposition(report:ReportDraft){
 const c=report.composition;if(c===undefined)return;if(!c)throw new Error('Invalid frozen composition.');
 const p=c.payload;
 if(c.format!=='inveos_report_composition_v1'||p.format!=='inveos_report_outline_v1'||p.caseId!==report.case.id||p.state!=='active'||!Number.isInteger(p.version)||p.version<1||p.version>100||compositionDigest(p)!==c.sha256||c.review.decision!=='accepted'||c.review.reviewerId===c.authorId)throw new Error('Frozen report composition integrity failed.');
 const context=report.investigation;
 if(!context||context.status!=='working_context_not_findings'||[context.objectives,context.questions,context.hypotheses,context.blockers,context.chronology,context.documentLinks,context.transcriptLinks,context.speechLinks].some(items=>items?.length))throw new Error('Composition v1 excludes unrelated working context.');
 verifyCompositionSelection(report,p);
}
