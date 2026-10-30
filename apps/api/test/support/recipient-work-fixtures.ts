import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {InternalCollaboratorWork,ReportDraft,WorkItem} from '@inveos/contracts';
import {sha,workflowFixture} from './workflow-fixture.js';

type Fixture=Awaited<ReturnType<typeof workflowFixture>>;
export const privateSource='Fictional INTERNAL-UNRELEASED source marker; never approved for the recipient.';
export const privateTask='Fictional INTERNAL-TASK body and history marker; never publish this text.';
export const privateDraftReason='Fictional INTERNAL-GRANT-REASON marker for saved investigator planning.';
export const privateReviewReason='Fictional INTERNAL-REVIEW-REASON marker; separate recipient-safe feedback is required.';
export const grantTitle='Fictional bounded collaborator assignment';
export const instructions='Inspect only the fictional packing checklist supplied in these instructions; report uncertainties in plain text.';
export const correctedInstructions='Corrected fictional instructions: inspect the packing checklist and separately state any unreadable entries.';
export const responseDraft='Fictional UNPUBLISHED-RESPONSE marker awaiting correction and independent review.';
export const publishedResponse='Fictional approved clarification: the released wording attributes the statement to the supplied note only.';

/** Approved PDF copy setup is explicit; feedback actions themselves are performed by the browser. */
export async function feedbackRelease(f:Fixture){
  await f.finding('Fictional RELEASED dispatch account says parcel alpha was listed.');
  const report=await f.must<{id:string;sha256:string}>(f.base+'/report-revisions',{idempotencyKey:randomUUID()}),path=f.base+'/report-revisions/'+report.id;
  const frozen=(await f.call(path)).rawPayload;
  assert.equal(sha(frozen),report.sha256);
  const pdf=await f.must<{id:string;pdfSha256:string;redactionSha256:string}>(path+'/renditions',{idempotencyKey:randomUUID(),redactedFindingIds:[]});
  const copyPath=path+'/renditions/'+pdf.id;
  const review={pdfSha256:pdf.pdfSha256,redactionSha256:pdf.redactionSha256,decision:'accept_for_disclosure',reason:'Fictional independent inspection of this exact PDF and source scope.',confirmInspected:true};
  assert.equal((await f.call(copyPath+'/reviews',review,f.maker)).statusCode,403,'copy author cannot review own copy');
  await f.must(copyPath+'/reviews',review,f.reviewer.headers);
  const release=await f.must<{id:string;sha256:string;reportSha256:string;deliverable:string}>(copyPath+'/disclosures',{pdfSha256:pdf.pdfSha256,recipientId:f.client.id,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'Fictional exact-copy recipient approval for controlled browser acceptance.',confirmReviewedDisclosure:true});
  assert.equal(release.deliverable,'report_pdf');assert.equal(release.sha256,pdf.pdfSha256);assert.equal(release.reportSha256,report.sha256);assert.notEqual(release.sha256,release.reportSha256);
  const external='/api/portal/disclosures/'+release.id,bytes=(await f.call(external,undefined,f.client.headers)).rawPayload;
  assert.equal(sha(bytes),pdf.pdfSha256);
  // This later finding is not part of the approved report/copy. No silent rerelease.
  const hidden=await f.finding(privateSource);
  assert.ok(!JSON.stringify(JSON.parse(frozen.toString()) as ReportDraft).includes(privateSource));
  return {report,pdf,release,external,publicBase:external+'/feedback',internal:f.base+'/disclosures/'+release.id+'/feedback',bytes,hidden};
}

/** Draft only: publication, acknowledgement, submission and review remain explicit journey actions. */
export async function collaboratorDraft(f:Fixture){
  const task=await f.must<WorkItem>(f.base+'/work',{id:randomUUID(),kind:'task',title:'Fictional private task title',body:privateTask,ownerId:f.investigator.id,dueDate:null,parentId:null},f.investigator.headers);
  const input={id:randomUUID(),taskId:task.id,taskVersion:task.version,recipientId:f.client.id,expiresAt:new Date(Date.now()+2*86400000).toISOString(),title:grantTitle,instructions,dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10),reason:privateDraftReason};
  const grant=await f.must<InternalCollaboratorWork>(f.base+'/restricted-work',input,f.investigator.headers);
  assert.equal(grant.publication,null);assert.equal(grant.eligible,false);
  const external='/api/portal/work/'+grant.id,internal=f.base+'/restricted-work/'+grant.id;
  assert.equal((await f.call(external,undefined,f.client.headers)).statusCode,404);
  assert.equal((await f.must<{items:unknown[]}>('/api/portal/work',undefined,f.client.headers)).items.length,0);
  return {task,grant,input,external,internal};
}

export function withoutSecrets(content:unknown,secrets:string[],label:string){
  const value=typeof content==='string'?content:JSON.stringify(content);
  for(const secret of secrets){assert.ok(secret.length>0);assert.ok(!value.includes(secret),label+' leaked '+secret);}
}
