export type Case = {id: string; ref: string; title: string; client: string; category: string; status: string; owner: string; due: string; scope: string; jurisdiction: string; authority: boolean};
export type Evidence = {id: string; caseId: string; filename: string; kind: string; bytes: number; sourceTime: string; receivedTime: string; digest: string; status: string; text: string; method: string; authorityId?: string; authorityVersion?: number; originalKind?: 'original_utf8' | 'opaque_binary'};
export type Claim = {id: string; caseId: string; evidenceId: string; text: string; quote: string; status: string; reason?: string};
export type Finding = {id: string; caseId: string; claimId: string; text: string; reviewer: string; reviewedAt: string};
export type Activity = {id: string; caseId: string; text: string; actor: string; at: string};
export type Workspace = {cases: Case[]; evidence: Evidence[]; claims: Claim[]; findings: Finding[]; activity: Activity[]};

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
  limitations: string;
};
