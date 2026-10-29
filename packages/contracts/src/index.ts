export type Case = {id: string; ref: string; title: string; client: string; category: string; status: string; owner: string; due: string; scope: string; jurisdiction: string; authority: boolean};
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
export type WorkLink = (WorkLinkInput | (DocumentWorkLinkInput & {kind: 'document_finding'; withdrawal?: {reason:string;createdBy:string;createdAt:string}})) & {caseId: string; itemId: string; createdBy: string; createdAt: string};
export type WorkRevision = {sources?: WorkLink[]; version: number; item: WorkItem; actor: string; reason: string; at: string};
export type CaseMember = {caseId: string; userId: string; name: string; role: 'reviewer' | 'investigator'};

export type AllegedTime = {precision: 'instant' | 'day' | 'month' | 'range' | 'unknown'; start: string | null; end: string | null; timezone: string; note: string};
export type ChronologySource = {kind: 'text_finding' | 'document_finding'; findingId: string};
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
  };
  limitations: string;
};

export type CaseSearchKind = 'original'|'claim'|'document_claim'|'text_finding'|'document_finding'|'work'|'chronology'|'entity'|'relationship'|'source_context';
export type CaseSearchFilter = {query:string;kind:'all'|CaseSearchKind;status:string};
export type CaseSearchResult = {interpretation:'stored_records_reverify_sources';items:Array<{kind:CaseSearchKind;id:string;title:string;excerpt:string;status:string;evidenceId:string|null;page:string}>;facets:Array<{kind:CaseSearchKind;count:number}>;next:{kind:CaseSearchKind;id:string}|null};
export type SavedCaseView = {id:string;name:string;filter:CaseSearchFilter;withdrawn:boolean;version:number};

export type GraphEntityKind = 'person'|'organisation'|'asset'|'place'|'incident'|'document';
export type GraphEntityInput = {id:string;kind:GraphEntityKind;label:string;detail:string};
export type GraphEntity = GraphEntityInput & {caseId:string;version:number;withdrawn:boolean;createdBy:string;recordedAt:string};
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

export type ManualSourceFields={url:string;publisher:string;retrievedAt:string;method:string;trustGrade:'unassessed'|'primary_record'|'secondary_report'|'disputed';termsReference:string;purpose:string;lawfulBasis:string;scope:string;retentionDays:number;minimisation:string;annotation:string};
export type ManualSourceOriginal={id:string;filename:string;sha256:string;sourceTime:string;receivedTime:string;authorityId:string;authorityVersion:number;status:string};
export type ManualSourceRecord=ManualSourceFields&{id:string;caseId:string;version:number;original:ManualSourceOriginal;recordedBy:string;recordedAt:string;withdrawn:boolean;digest:string};
export type ManualSourceReview={id:string;digest:string;accepted:boolean;reviewerId:string;reviewerName:string;reason:string;recordedAt:string};
export type ManualSourceEntry={record:ManualSourceRecord;review:ManualSourceReview|null;state:'pending'|'record_accepted'|'record_rejected'|'withdrawn'|'authority_changed';canReview:boolean};
