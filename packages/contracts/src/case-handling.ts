export const caseSensitivityTiers=['standard','sensitive','restricted'] as const;
export type CaseSensitivityTier=typeof caseSensitivityTiers[number];
export type CaseSharing='existing_release_controls'|'internal_only';
export type CaseHandlingDecision={id:string;caseId:string;version:number;tier:CaseSensitivityTier;sharing:CaseSharing;instructions:string;reason:string;authorityVersion:number|null;actorId:string;actorName:string;recordedAt:string;sha256:string};
export type CaseHandling={version:number;authorityVersion:number|null;current:CaseHandlingDecision|null;history:CaseHandlingDecision[];nextBefore:number|null;canDecide:boolean;sharingAllowed:boolean;blockReason:string|null};
