export const caseStages=['Intake','Scope review','Active','Review','Released','Closed','Archived'] as const;
export type CaseStage=typeof caseStages[number];
export type CaseLifecycle={state:CaseStage;version:number;collectionOpen:boolean;canManage:boolean;allowed:CaseStage[];history:{id:string;version:number;from:CaseStage|null;to:CaseStage;actorId:string|null;reason:string;source:string;authorityVersion:number|null;disclosureId:string|null;recordedAt:string}[];nextBefore:number|null;disclosures:{id:string;createdAt:string}[]};
export type Case = {id: string; ref: string; title: string; client: string; category: string; status: string; owner: string; due: string; scope: string; jurisdiction: string; authority: boolean; lifecycle?: {state:CaseStage;version:number;collectionOpen:boolean}};
export type Evidence = {id: string; caseId: string; filename: string; kind: string; bytes: number; sourceTime: string; receivedTime: string; digest: string; status: string; text: string; method: string; authorityId?: string; authorityVersion?: number; originalKind?: 'original_utf8' | 'opaque_binary'};
export type Claim = {id: string; caseId: string; evidenceId: string; text: string; quote: string; status: string; reason?: string; sourceStartByte?: number; sourceEndByte?: number; sourceDigest?: string};
export type Finding = {id: string; caseId: string; claimId: string; text: string; reviewer: string; reviewedAt: string};
export type Activity = {id: string; caseId: string; text: string; actor: string; at: string};
export type Workspace = {cases: Case[]; evidence: Evidence[]; claims: Claim[]; findings: Finding[]; activity: Activity[]; workItems: WorkItem[]; workLinks: WorkLink[]; members: CaseMember[]};

export const workStatuses = {
  objective: ['Open', 'In progress', 'Blocked', 'Complete'],
  question: ['Open', 'In progress', 'Blocked', 'Resolved'],
  hypothesis: ['Proposed', 'Supported', 'Disputed', 'Rejected'],
  task: ['To do', 'In progress', 'Blocked', 'Complete'],
  note: ['Recorded'],
  handover: ['Open', 'Acknowledged'],
} as const;
export type WorkKind = keyof typeof workStatuses;
export type WorkStatus = typeof workStatuses[WorkKind][number];
export type WorkInput = {
  id: string;
  kind: WorkKind;
  title: string;
  body: string;
  ownerId: string | null;
  dueDate: string | null;
  parentId: string | null;
};
export type WorkEdit = {
  expectedVersion: number;
  title: string;
  body: string;
  status: WorkStatus;
  ownerId: string | null;
  dueDate: string | null;
  reason: string;
};
export type TaskStatusBatch = {id:string; items:{id:string;expectedVersion:number}[];status:typeof workStatuses.task[number];reason:string};
export type TaskPlanBatch = {id:string;items:{id:string;expectedVersion:number}[];ownerChange?:{ownerId:string|null};dueDateChange?:{dueDate:string|null};reason:string};
export type TaskStatusBatchResult = {id:string;applied:{id:string;version:number}[];items:WorkItem[]};
export type WorkItem = WorkInput & {
  caseId: string;
  status: WorkStatus;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type WorkLinkInput = {
  id: string;
  claimId: string;
  relation: 'supports' | 'contradicts' | 'context';
  reason: string;
};
export type DocumentWorkLinkInput = {id: string; findingId: string; relation: WorkLinkInput['relation']; reason: string};
export type WorkLink = (WorkLinkInput | (DocumentWorkLinkInput & ({kind: 'document_finding'} | {kind: 'transcript_finding'} | {kind:'speech_finding'}) & {withdrawal?: {reason:string;createdBy:string;createdAt:string}})) & {caseId: string; itemId: string; createdBy: string; createdAt: string};
export type WorkRevision = {sources?: WorkLink[]; version: number; item: WorkItem; actor: string; reason: string; at: string};
export type CaseMember = {caseId: string; userId: string; name: string; role: 'reviewer' | 'investigator'};

export type AllegedTime = {precision: 'instant' | 'day' | 'month' | 'range' | 'unknown'; start: string | null; end: string | null; timezone: string; note: string};
export type ChronologySource = {kind: 'text_finding' | 'document_finding' | 'transcript_finding'; findingId: string};
export type ChronologyInput = {id: string; title: string; account: string; time: AllegedTime; source: ChronologySource; status: 'alleged' | 'disputed' | 'withdrawn'};
export type ChronologyEvent = ChronologyInput & {caseId: string; version: number; createdBy: string; createdAt: string; recordedAt: string; interpretation: 'recorded_account_not_finding'};
export type ChronologyEdit = Omit<ChronologyInput, 'id'> & {expectedVersion: number; reason: string};
export type ChronologyRevision = {event: ChronologyEvent; actor: string; reason: string; at: string};

export type AuthorityInput = {
  purpose: string;
  lawfulBasis: string;
  scope: string;
  retentionDays: number;
  minimisation: string;
};

export type AuthorityRecord = AuthorityInput & {
  id: string;
  caseId: string;
  version: number;
  approvedBy: string;
  approvedAt: string;
};

export type CaseInput = Pick<Case, 'title' | 'client' | 'scope' | 'jurisdiction'>;

export type EvidenceInput = {
  filename: string;
  text: string;
  expectedSha256: string;
  sourceTime: string;
  method: string;
  idempotencyKey: string;
};

export type BinaryEvidenceInput = Omit<EvidenceInput, 'text'> & {
  contentBase64: string;
};

export type ClaimInput = {
  evidenceId: string;
  text: string;
  quote: string;
  sourceStartByte?: number;
  sourceEndByte?: number;
};

export type ReviewInput = {
  accepted: boolean;
  reason: string;
};

export type SourcePolicyReference = {
  authorityId: string;
  authorityVersion: number;
  purpose: string;
  lawfulBasis: string;
  scope: string;
  retentionDays: number;
  minimisation: string;
};

export type DocumentReportFinding = {
  kind: 'derived_document'; id: string; text: string; reviewer: string; reviewedAt: string;
  source: {id: string; filename: string; sha256: string; sourceTime: string; receivedTime: string; authorityId: string; authorityVersion: number};
  extraction: {jobId: string; authorityVersion: number; attempt: number; processedAt: string; profile: string; profileDigest: string; rawDigest: string; derivativeDigest: string};
  reference: {citationId: string; citationDigest: string; offsetBasis: string; itemRef: string; page: number; bbox: {l:number;t:number;r:number;b:number;origin:string}; startByte: number; endByte: number; quote: string};
  correspondence: {id: string; digest: string; reviewer: string; reviewedAt: string; reason: string};
  interpretation: {claimId: string; claimDigest: string; decisionId: string; decisionDigest: string; reason: string};
  limitations: string;
};

export type ReportDraft = {
  status: 'draft_not_released';
  documentFindings?: DocumentReportFinding[];
  transcriptFindings?: TranscriptReportFinding[];
  speechFindings?: SpeechReportFinding[];
  sourceUse?: SourceUseProof[];
  case: Pick<Case, 'id' | 'ref' | 'title' | 'client' | 'scope' | 'jurisdiction'>;
  findings: Array<{
    id: string;
    text: string;
    reviewer: string;
    reviewedAt: string;
    source: {
      id: string;
      filename: string;
      sha256: string;
      sourceTime: string;
      receivedTime: string;
      quote: string;
      startByte: number;
      endByte: number;
      contentBase64: string;
      policy: SourcePolicyReference;
    };
  }>;
  investigation: {
    status: 'working_context_not_findings';
    chronology?: ChronologyEvent[];
    objectives: WorkItem[];
    questions: WorkItem[];
    hypotheses: WorkItem[];
    blockers: WorkItem[];
    documentLinks?: Array<Extract<WorkLink, {kind: 'document_finding'}>>;
    transcriptLinks?: Array<Extract<WorkLink, {kind: 'transcript_finding'}>>;
    speechLinks?: Array<Extract<WorkLink, {kind:'speech_finding'}>>;
  };
  limitations: string;
};

export type CaseSearchKind = 'original'|'claim'|'document_claim'|'document_text'|'text_finding'|'document_finding'|'work'|'chronology'|'entity'|'relationship'|'source_context'|'transcript'|'transcript_claim'|'transcript_finding'|'speech_claim'|'speech_finding';
export type CaseSearchFilter = {query:string;kind:'all'|CaseSearchKind;status:string};
export type CaseSearchResult = {interpretation:'stored_records_reverify_sources';items:Array<{kind:CaseSearchKind;id:string;title:string;excerpt:string;status:string;evidenceId:string|null;page:string;speechJobId?:string}>;facets:Array<{kind:CaseSearchKind;count:number}>;next:{kind:CaseSearchKind;id:string}|null};
export type SavedCaseView = {id:string;name:string;filter:CaseSearchFilter;withdrawn:boolean;version:number};

export type GraphEntityKind = 'person'|'organisation'|'asset'|'place'|'incident'|'document';
// Property names adapted from FollowTheMoney at c70a89ffa59ea785956f6095643310da3735b7fb.
// Copyright (c) 2017-2024 Journalism Development Network, Inc.; MIT, third_party/followthemoney/LICENSE.
export const entityAttributeLabels = {alias:'Other name',previousName:'Previous name',registrationNumber:'Registration number',jurisdiction:'Jurisdiction',legalForm:'Legal form',incorporationDate:'Incorporation date',idNumber:'Identifier',website:'Website'} as const;
export type EntityAttributeProperty=keyof typeof entityAttributeLabels;
export type EntityAttributeInput={property:EntityAttributeProperty;value:string;source:ChronologySource};
export type EntityAttribute=Omit<EntityAttributeInput,'source'>&{source:GraphSource};
export type GraphEntityInput = {id:string;kind:GraphEntityKind;label:string;detail:string;attributes?:EntityAttributeInput[]};
export type GraphEntity = Omit<GraphEntityInput,'attributes'> & {attributes?:EntityAttribute[]} & {caseId:string;version:number;withdrawn:boolean;createdBy:string;recordedAt:string};
export type GraphEntityRef = Pick<GraphEntity,'id'|'version'|'kind'|'label'>;
export type GraphSource = ChronologySource & {sha256:string;authorityVersion:number};
export type GraphProposalInput = {id:string;from:Pick<GraphEntityRef,'id'|'version'>;to:Pick<GraphEntityRef,'id'|'version'>;relationship:string;account:string;sources:ChronologySource[]};
export type GraphProposal = Omit<GraphProposalInput,'from'|'to'|'sources'> & {caseId:string;from:GraphEntityRef;to:GraphEntityRef;sources:GraphSource[];version:number;proposedBy:string;proposedAt:string;withdrawn:boolean;digest:string};
export type GraphReview = {id:string;accepted:boolean;reason:string;reviewerId:string;reviewerName:string;recordedAt:string;digest:string};
export type GraphRelationship = {proposal:GraphProposal;review:GraphReview|null;state:'candidate'|'confirmed'|'rejected'|'withdrawn'|'needs_review';canReview:boolean};
export type CaseGraph = {entities:GraphEntity[];relationships:GraphRelationship[];sourceVerification:'not_checked_on_listing'};
export type WorkCommentInput={body:string;mentions:string[];reason:string};
export type WorkComment={id:string;itemId:string;authorId:string;authorName:string;version:number;body:string;mentions:{userId:string;name:string}[];withdrawn:boolean;reason:string;createdAt:string;recordedAt:string;canEdit:boolean};
export type WorkMentionPage={items:{commentId:string;itemId:string;version:number;authorName:string;excerpt:string;title:string;recordedAt:string}[];more:boolean};

export type AssignedWorkEntry=Pick<WorkItem,'id'|'caseId'|'kind'|'title'|'status'|'version'|'dueDate'|'updatedAt'>&{excerpt:string;caseRef:string;caseTitle:string};
export type AssignedWorkPage={items:AssignedWorkEntry[];more:boolean;next:{id:string;dueDate:string|null}|null;interpretation:'assigned_work_not_a_finding'};
export type ManualSourceFields={url:string;publisher:string;retrievedAt:string;method:string;trustGrade:'unassessed'|'primary_record'|'secondary_report'|'disputed';termsReference:string;purpose:string;lawfulBasis:string;scope:string;retentionDays:number;minimisation:string;annotation:string};
export type ManualSourceOriginal={id:string;filename:string;sha256:string;sourceTime:string;receivedTime:string;authorityId:string;authorityVersion:number;status:string};
export type ManualSourceRecord=ManualSourceFields&{id:string;caseId:string;version:number;original:ManualSourceOriginal;recordedBy:string;recordedAt:string;withdrawn:boolean;digest:string};
export type ManualSourceReview={id:string;digest:string;accepted:boolean;reviewerId:string;reviewerName:string;reason:string;recordedAt:string};
export type ManualSourceEntry={record:ManualSourceRecord;review:ManualSourceReview|null;state:'pending'|'record_accepted'|'record_rejected'|'withdrawn'|'authority_changed';canReview:boolean};

export type SuppliedTranscriptSegment={id:string;startMs:number;endMs:number;speakerLabel:string;speakerUncertain:boolean;text:string};
export type TranscriptCorrection={id:string;version:number;startMs:number;endMs:number;speakerLabel:string;speakerUncertain:boolean;text:string;reason:string;actorId:string;actorName:string;recordedAt:string};
export type InterviewTranscript={id:string;caseId:string;title:string;createdBy:string;createdAt:string;source:{evidenceId:string;digest:string;authorityVersion:number;sourceTime:string;receivedTime:string;filename:string};segments:{id:string;sourcePointer:string;raw:SuppliedTranscriptSegment;current:TranscriptCorrection|null;currentVersion:number}[];interpretation:'raw_and_corrected_transcript_not_findings'};

export type CaseAccessAction='member_added'|'member_removed'|'owner_transferred';
export type CaseAccessMember={id:string;name:string;role:'reviewer'|'investigator'|'client';joinedAt:string};
export type CaseAccessState={version:number;ownerId:string;canManage:boolean;members:CaseAccessMember[];next:string|null};
export type CaseAccessEvent={id:string;version:number;action:CaseAccessAction|'case_created'|'legacy_checkpoint';ownerId:string;subjectId:string|null;subjectName:string|null;actorId:string|null;actorName:string|null;reason:string;recordedAt:string};

export type PreservationHoldFields={label:string;authorityReference:string;purpose:string;reason:string};
export type PreservationHold=PreservationHoldFields&{id:string;version:number;status:'active'|'released';action:'declared'|'amended'|'released';source:{id:string;sha256:string;filename:string;authorityVersion:number}|null;createdBy:string;createdAt:string;actorId:string;actorName:string;recordedAt:string};
export type CaseTimeFields={startedAt:string;minutes:number;description:string;billable:boolean};
export type CaseBudgetVersion={id:string;version:number;action:'allocated'|'revised'|'withdrawn';minutes:number;reason:string;actorId:string;actorName:string;recordedAt:string};
export type CaseBudgetSnapshot={caseId:string;current:CaseBudgetVersion|null;usage:{entries:number;minutes:number;markedChargeableMinutes:number};remainingMinutes:number|null;observedAt:string;interpretation:'declared_time_planning_only'};
export type CaseTimeEntry=CaseTimeFields&{id:string;version:number;startedAtUtc:string;status:'active'|'withdrawn';action:'recorded'|'corrected'|'withdrawn';reason:string;authorId:string;author:string;createdAt:string;actorId:string;actorName:string;recordedAt:string;canCorrect:boolean};

export type AttentionPreferences={version:number;deadlines:boolean;failures:boolean;reviews:boolean;recordedAt:string|null};
export type ReviewOwnership={version:number;assigneeId:string|null;assigneeName:string|null;assigneeAvailable:boolean};
export type ReviewAssignment=ReviewOwnership&{id:string;actorId:string;actorName:string;reason:string;recordedAt:string};
export type ReviewAssignmentPage={current:ReviewAssignment|null;pending:boolean;history:ReviewAssignment[];next:number|null;candidates:{id:string;name:string}[];candidatesNext:string|null};
export type ReviewAssignmentContext=Pick<AttentionEntry,'key'|'revision'|'caseId'|'caseRef'|'caseTitle'|'title'>;
export type ReviewRegisterCursor={caseId:string;key:string;revision:string};
export type ReviewRegisterPage={items:(ReviewAssignmentContext&{pending:boolean;assignment:ReviewAssignment})[];next:ReviewRegisterCursor|null};
export type AttentionEntry={key:string;revision:string;caseId:string;caseRef:string;caseTitle:string;id:string;kind:'deadline'|'upload_expired'|'processing_failed'|'claim_review'|'document_review'|'transcript_review'|'report_review'|'pdf_review'|'docx_review'|'correspondence_review'|'source_review'|'expense_review';category:'deadlines'|'failures'|'reviews';title:string;status:string;dueDate:string|null;workKind:WorkKind|null;evidenceId:string|null;jobId:string|null;contextId?:string|null;acknowledged?:boolean;assignment?:ReviewOwnership|null};
export type AttentionPage={items:AttentionEntry[];next:string|null;preferences:AttentionPreferences;asOf:string;interpretation:'personal_attention_not_review'};

export type FieldDevice={id:string;label:string;createdAt:string;revokedAt:string|null;revocationReason:string|null};
export type FieldContext={tenantId:string;userId:string;caseId:string;device:FieldDevice;authority:AuthorityRecord;checkedAt:string;maxOriginalBytes:number};
export type FieldManifest={id:string;deviceId:string;authorityId:string;authorityVersion:number;filename:string;sourceTime:string;capturedAt:string;clockUncertaintySeconds:number|null;method:string;expectedSha256:string;byteLength:number;kind:'supplied_file'|'field_note';scopeConfirmed:true};
export type FieldCaptureReceipt={capture:{id:string;caseId:string;deviceId:string;authorityId:string;authorityVersion:number;manifestSha256:string;receivedAt:string};evidence:Evidence};

export type TranscriptClaimInput={id:string;transcriptId:string;segmentId:string;expectedVersion:number;text:string;startByte:number;endByte:number;quote:string};
export type TranscriptClaim={
 id:string;caseId:string;text:string;proposedBy:string;proposedAt:string;digest:string;
 source:{id:string;filename:string;sha256:string;sourceTime:string;receivedTime:string;policy:SourcePolicyReference};
 transcript:{id:string;title:string;registeredBy:string;registeredAt:string;segmentId:string;sourcePointer:string;version:number;raw:SuppliedTranscriptSegment;corrections:TranscriptCorrection[]};
 reference:{offsetBasis:'selected_transcript_utf8_not_original_media';startByte:number;endByte:number;quote:string;startMs:number;endMs:number;speakerLabel:string;speakerUncertain:boolean};
 limitations:string;
};
export type TranscriptClaimReview={id:string;claimId:string;claimDigest:string;accepted:boolean;reason:string;reviewerId:string;reviewerName:string;recordedAt:string};
export type TranscriptClaimRecord={claim:TranscriptClaim;review:TranscriptClaimReview|null;findingId:string|null;withdrawal:{id:string;actorId:string;reason:string;recordedAt:string}|null;state:'candidate'|'reviewed'|'rejected'|'needs_review'|'withdrawn';canReview:boolean;canWithdraw:boolean};
export type TranscriptReportFinding={kind:'reviewed_transcript';id:string;text:string;reviewer:string;reviewedAt:string;claim:TranscriptClaim;review:TranscriptClaimReview;originalBase64:string};

export type ReviewedSourceFinding = ReportDraft['findings'][number] | DocumentReportFinding | TranscriptReportFinding;

export type CaseInvitation={id:string;caseId:string;caseRef:string;caseTitle:string;recipientId:string;recipientName:string;ownerId:string;ownerName:string;reason:string;authorityVersion:number;approvedScope:string;approvedPurpose:string;offeredAt:string;expiresAt:string;response:{id:string;decision:'accept'|'decline';reason:string;actorId:string;recordedAt:string;accessVersion:number|null}|null;cancellation:{id:string;reason:string;actorId:string;recordedAt:string}|null;hasCurrentMembership:boolean;canAccept:boolean;state:'offered'|'accepted'|'declined'|'cancelled'|'expired'|'scope_changed'|'already_assigned'};
export type CaseInvitationPage={items:CaseInvitation[];next:string|null};

export type SourceUseDecision={id:string;caseId:string;sourceId:string;evidenceId:string;sequence:number;sourceVersion:number;sourceDigest:string;authorityVersion:number;permission:'blocked'|'analysis'|'analysis_and_release';reason:string;actorId:string;actorName:string;recordedAt:string;expiresAt:string|null;digest:string};
export type SourceUseProof={decision:SourceUseDecision;record:ManualSourceRecord;metadataReview:ManualSourceReview;collection?:CollectionProvenance};
export type SourceUseState={items:SourceUseDecision[];analysisAllowed:boolean;releaseAllowed:boolean;canDecide:boolean;sourceVersion:number;sourceDigest:string};

export type CaseCurrency='GBP'|'EUR'|'USD';
export type CaseExpenseFields={incurredOn:string;currency:CaseCurrency;amountMinor:number;description:string;receiptId:string|null};
export type CaseExpenseReview={id:string;accepted:boolean;reason:string;actorId:string;actorName:string;recordedAt:string};
export type CaseExpense=CaseExpenseFields&{id:string;version:number;action:'recorded'|'corrected'|'withdrawn';reason:string;authorId:string;authorName:string;createdAt:string;actorId:string;actorName:string;recordedAt:string;receipt:ManualSourceOriginal|null;review:CaseExpenseReview|null;canCorrect:boolean;canReview:boolean};
export type SpendingBudget={id:string;currency:CaseCurrency;version:number;action:'allocated'|'revised'|'withdrawn';amountMinor:number;reason:string;actorId:string;actorName:string;recordedAt:string};
export type CaseSpending={caseId:string;observedAt:string;currencies:{currency:CaseCurrency;current:SpendingBudget|null;entries:number;declaredMinor:number;acceptedMinor:number;pendingMinor:number;rejectedMinor:number;remainingDeclaredMinor:number|null}[];interpretation:'declared_expenses_and_recorded_reviews_only'};
export {inspectPcm,type PcmSource} from './pcm.js';

export type SpeechSegment={index:number;sourcePointer:string;startMs:number;endMs:number;text:string;startByte:number;endByte:number;rangeWithinOriginal:boolean;ordered:boolean};
export type SpeechDerivative={format:'inveos_speech_derivative_v1';context:{tenantId:string;caseId:string;jobId:string;evidenceId:string;sourceDigest:string;authorityVersion:number};profileDigest:string;rawDigest:string;reviewState:'unreviewed';offsetBasis:'recognised_utf8_not_original_audio';audio:import('./pcm.js').PcmSource;text:string;segments:SpeechSegment[];coverage:{reportedRangesValid:boolean;alignmentVerified:false;speechAccuracyVerified:false}};
export type SpeechCorrection={id:string;segmentIndex:number;version:number;startMs:number;endMs:number;hasSpeech:boolean;text:string;speakerLabel:string;speakerUncertain:boolean;reason:string;actorId:string;actorName:string;recordedAt:string};
export type SpeechSegmentReview={id:string;segmentIndex:number;version:number;accepted:boolean;reason:string;reviewerId:string;reviewerName:string;recordedAt:string;digest:string};
export type SpeechTranscript={caseId:string;jobId:string;source:{evidenceId:string;digest:string;filename:string;sourceTime:string;receivedTime:string;authorityId:string;authorityVersion:number};profile:Record<string,unknown>;profileDigest:string;rawDigest:string;derivativeDigest:string;processedAt:string;requestedBy:string;derivative:SpeechDerivative;segments:{raw:SpeechSegment;current:SpeechCorrection|null;currentVersion:number;review:SpeechSegmentReview|null;canReview:boolean;canAccept:boolean}[];interpretation:'raw_and_corrected_speech_not_findings'};

export type SpeechAccount=Pick<SpeechCorrection,'startMs'|'endMs'|'hasSpeech'|'text'|'speakerLabel'|'speakerUncertain'>;
export type SpeechReviewContext={format:'inveos.speech_review_context.v1';caseId:string;jobId:string;sourceDigest:string;derivativeDigest:string;authorityVersion:number;segmentIndex:number;version:number;account:SpeechAccount};
export type SpeechContextPackage={format:'inveos.speech_context.v1';sha256:string;payload:{caseId:string;jobId:string;source:SpeechTranscript['source']&{originalBase64:string};profile:string;profileDigest:string;rawBase64:string;rawDigest:string;derivative:SpeechDerivative;derivativeDigest:string;processedAt:string;requestedBy:string;segments:{raw:SpeechSegment;corrections:SpeechCorrection[];reviews:{context:SpeechReviewContext;decision:SpeechSegmentReview}[]}[];sourceUse:SourceUseProof[];exportedAt:string;interpretation:'internal_speech_context_not_findings'}};
export type SpeechClaimInput={id:string;jobId:string;segmentIndex:number;expectedVersion:number;correspondenceDigest:string;text:string;startByte:number;endByte:number;quote:string};
export type SpeechClaim={id:string;caseId:string;text:string;proposedBy:string;proposedAt:string;digest:string;source:TranscriptClaim['source'];context:SpeechContextPackage;reference:{jobId:string;segmentIndex:number;version:number;correspondenceDigest:string;offsetBasis:'selected_speech_utf8_not_original_audio';startByte:number;endByte:number;quote:string;account:SpeechAccount};limitations:string};
export type SpeechClaimRecord={claim:SpeechClaim;review:TranscriptClaimReview|null;findingId:string|null;withdrawal:TranscriptClaimRecord['withdrawal'];state:TranscriptClaimRecord['state'];canReview:boolean;canWithdraw:boolean};
export type SpeechReportFinding={kind:'reviewed_speech';id:string;text:string;reviewer:string;reviewedAt:string;source:TranscriptClaim['source'];claim:SpeechClaim;review:TranscriptClaimReview};


export type ConnectorPolicyProposal={id:string;adapterId:'companies_house_profile_v1';expectedVersion:number;profileDigest:string;purpose:string;lawfulBasis:string;termsReference:string;termsSha256:string;minimisation:string;retentionDays:number;requestsPerWindow:number;validUntil:string;reason:string};
export type ConnectorPolicyVersion=Omit<ConnectorPolicyProposal,'expectedVersion'>&{version:number;proposedBy:string;proposedByName:string;proposedAt:string;review:{id:string;accepted:boolean;reason:string;legalApprovalReference:string;reviewerId:string;reviewerName:string;recordedAt:string}|null;withdrawal:{id:string;actorId:string;actorName:string;reason:string;recordedAt:string}|null;state:'candidate'|'approved'|'rejected'|'withdrawn'|'expired'|'superseded';canReview:boolean};

export type CollectionAuthorisationInput={id:string;policyVersion:number;authorityVersion:number;companyNumber:string;purpose:string;minimisation:string;retentionDays:number;validUntil:string};
export type CollectionAuthorisation=CollectionAuthorisationInput&{authorId:string;authorName:string;recordedAt:string;withdrawn:boolean};
export type CollectionJob={id:string;authorisationId:string;companyNumber:string;status:'queued'|'running'|'succeeded'|'failed'|'cancelled';requestedAt:string;failureCode:string|null;evidenceId:string|null;sourceId:string|null};
export type CollectionReceipt={schemaVersion:'inveos.collection.v1';captureMode:'fictional_fixture'|'provider';tenantId:string;caseId:string;jobId:string;authorisationId:string;authorityVersion:number;policyVersion:number;profileDigest:string;url:string;companyNumber:string;httpStatus:200;sourceTime:string;sourceTimeBasis:'http_response_date_not_record_creation';receivedAt:string;etag:string|null;contentType:string;originalSha256:string;byteLength:number;fields:{pointer:string;value:string}[];interpretation:'unreviewed_provider_assertions'};

export type CollectionProvenance={payload:{schemaVersion:'inveos.collection-provenance.v1';receipt:CollectionReceipt;receiptSha256:string;authorisation:Record<string,unknown>;caseAuthority:Record<string,unknown>;sourcePolicy:Record<string,unknown>;policyReview:Record<string,unknown>};sha256:string};
