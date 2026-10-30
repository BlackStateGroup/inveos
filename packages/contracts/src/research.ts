/** Bounded research workflows. A policy declaration is not provider activation. */
export type ResearchAdapterId='rdap_domain_v1'|'supplied_webpage_v1'|'gleif_lei_v1';
export type ResearchRequestInput={id:string;requestId:string;expectedVersion:number;adapterId:ResearchAdapterId;policyVersion:number;authorityVersion:number;title:string;target:string;purpose:string;minimisation:string;retentionDays:number;validUntil:string;reason:string};
export type ResearchRequest=Omit<ResearchRequestInput,'expectedVersion'>&{version:number;tenantId:string;caseId:string;authorityId:string;profileDigest:string;endpointScope:string;credentialScope:'none:controlled-input';authorId:string;authorName:string;recordedAt:string;digest:string};
export type ResearchRequestEntry={request:ResearchRequest;withdrawn:boolean;permission:'available'|'withdrawn'|'expired'|'policy_or_authority_changed'};
export type ResearchRun={id:string;requestId:string;requestVersion:number;adapterId:ResearchAdapterId;title:string;target:string;requestedBy:string;requestedAt:string;previousRunId:string|null;executionMode:'supplied'|'rdap_transport'|'lei_transport';status:'queued'|'running'|'succeeded'|'failed'|'cancelled';failureCode:string|null;evidenceId:string|null;sourceId:string|null};
export type ResearchCaptureInput={contentBase64:string;mediaType:'application/rdap+json'|'application/vnd.api+json'|'application/json'|'text/html'|'text/plain';filename:string;publisher:string;sourceTime:string;sourceTimeBasis:'declared_response_date'|'declared_page_time';retrievedAt:string;captureMode:'fictional_fixture'|'controlled_response'|'supplied_webpage';fictional:true};
export type ResearchReceipt={schemaVersion:'inveos.research-capture.v1';tenantId:string;caseId:string;runId:string;requestId:string;requestVersion:number;requestDigest:string;adapterId:ResearchAdapterId;profileDigest:string;policyVersion:number;authorityVersion:number;url:string;target:string;endpointScope:string;credentialScope:'none:controlled-input';captureMode:ResearchCaptureInput['captureMode']|'fictional_transport';fictional:true;sourceTime:string;sourceTimeBasis:ResearchCaptureInput['sourceTimeBasis']|'http_response_date_not_record_creation';retrievedAt:string;receivedAt:string;mediaType:ResearchCaptureInput['mediaType'];filename:string;publisher:string;originalSha256:string;byteLength:number;fields:{pointer:string;value:string}[];interpretation:'unreviewed_supplied_assertions';networkRequests:0|1;response?:{status:200;date:string;etag:string|null;transport:'loopback_http_fixture'}};
export type ResearchProvenance={payload:{schemaVersion:'inveos.research-provenance.v1';receipt:ResearchReceipt;receiptSha256:string;request:ResearchRequest;caseAuthority:Record<string,unknown>;sourcePolicy:Record<string,unknown>;policyReview:Record<string,unknown>;policyScope:{endpoint_scope:string;credential_scope:string}};sha256:string};

/** Plain text presentation only. No original bytes, active URLs or hidden proof payload. */
export function researchProvenanceRows(proof:ResearchProvenance):Array<[string,string]>{
 const p=proof.payload,r=p.receipt,q=p.request,s=p.sourcePolicy,review=p.policyReview;
 const text=(v:unknown)=>{if(typeof v!=='string')throw new Error('Research provenance presentation field missing.');return v;};
 const modes:Record<ResearchReceipt['captureMode'],string>={fictional_fixture:'Fictional supplied fixture; no provider contacted',controlled_response:'Controlled supplied response; transport not observed',supplied_webpage:'Supplied webpage; original HTML remains inert',fictional_transport:'Fictional loopback HTTP response; no provider contacted'};
 const basis=r.sourceTimeBasis==='http_response_date_not_record_creation'?'HTTP response Date, not entity/domain creation':r.sourceTimeBasis==='declared_response_date'?'Declared response time; transport not observed':'Declared page/source time; not authenticated by acquisition';
 const rows:Array<[string,string]>=[
  ['Research provenance',`${r.adapterId}; ${modes[r.captureMode]}`],
  ['Declared source URL',r.url],['Research request',`${q.requestId} v${q.version}; ${q.title}`],
  ['Request author',`${q.authorName} (${q.authorId}); recorded ${q.recordedAt}`],['Request change reason',q.reason],
  ['Request scope',`${q.target}; exact endpoint ${q.endpointScope}`],['Research purpose',q.purpose],['Research minimisation',q.minimisation],
  ['Research receipt',`${r.runId}; SHA-256 ${p.receiptSha256}`],['Request SHA-256',q.digest],['Provenance SHA-256',proof.sha256],
  ['Captured original',`${r.filename}; ${r.mediaType}; ${r.byteLength} bytes; SHA-256 ${r.originalSha256}`],['Declared publisher',r.publisher],
  ['Source time',`${r.sourceTime}; ${basis}`],['Declared retrieval time',r.retrievedAt],['Server receipt time',r.receivedAt],
  ['Historical permission',`case authority ${q.authorityId} v${r.authorityVersion}; source policy v${r.policyVersion}; request expires ${q.validUntil}`],
  ['Source policy profile',r.profileDigest],['Inspected terms reference',text(s.terms_reference)],['Inspected terms SHA-256',text(s.terms_sha256)],
  ['Source policy declaration',`${text(s.purpose)}; expires ${text(s.valid_until)}`],['Policy minimisation',text(s.minimisation)],
  ['Source lawful-basis declaration',text(s.lawful_basis)],['Independent policy decision',`${text(review.reviewer_name)} (${text(review.reviewer_id)}); ${text(review.recorded_at)}; ${review.accepted===true?'accepted':'not accepted'}`],
  ['Policy approval reference',text(review.legal_approval_reference)],['Policy decision reason',text(review.reason)],
  ['Capture limits',`${q.retentionDays} retention days; ${String(s.requests_per_window)} attempts per five minutes; credential scope ${r.credentialScope}; ${r.networkRequests} fixture network requests`],
 ];
 if(r.response)rows.push(['Observed fixture response',`HTTP ${r.response.status}; Date ${r.response.date}; ETag ${r.response.etag??'not supplied'}; ${r.response.transport}`]);
 for(const field of r.fields)rows.push(['Unreviewed source field',`${field.pointer}: ${field.value}`]);
 rows.push(['Research limitation','Historical capture permission does not grant current source use or client release. Preserved assertions require separate metadata, source-use and finding review; provider truth, actor authenticity and legal approval are not established.']);
 return rows;
}
