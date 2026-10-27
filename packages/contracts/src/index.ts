export type Case = {id: string; ref: string; title: string; client: string; category: string; status: string; owner: string; due: string; scope: string; jurisdiction: string; authority: boolean};
export type Evidence = {id: string; caseId: string; filename: string; kind: string; bytes: number; sourceTime: string; receivedTime: string; digest: string; status: string; text: string; method: string; authorityId?: string; authorityVersion?: number; originalKind?: 'original_utf8' | 'opaque_binary'};
export type Claim = {id: string; caseId: string; evidenceId: string; text: string; quote: string; status: string; reason?: string};
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
export type WorkLink = WorkLinkInput & {caseId: string; itemId: string; createdBy: string; createdAt: string};
export type WorkRevision = {version: number; item: WorkItem; actor: string; reason: string; at: string};
export type CaseMember = {caseId: string; userId: string; name: string; role: 'reviewer' | 'investigator'};

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

export type ReportDraft = {
  status: 'draft_not_released';
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
    objectives: WorkItem[];
    questions: WorkItem[];
    hypotheses: WorkItem[];
    blockers: WorkItem[];
  };
  limitations: string;
};
