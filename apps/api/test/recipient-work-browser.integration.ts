/** Explicit real browser / HTTP / PostgreSQL journeys. No skip or sandbox fallback.
 * Root runs this .integration.ts on the hosted sandbox-capable runner after a web build. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import type {ExternalWork,FeedbackDetail,FeedbackRequestPage,InternalCollaboratorWork} from '@inveos/contracts';
import {recipientWorkBrowser} from './support/recipient-work-browser.js';
import {feedbackRelease,collaboratorDraft,withoutSecrets,privateSource,privateTask,privateDraftReason,privateReviewReason,grantTitle,instructions,correctedInstructions,responseDraft,publishedResponse} from './support/recipient-work-fixtures.js';
import {tenant} from './support/workflow-fixture.js';

const clientFeedback='[aria-label="Client release feedback"]',internalFeedback='[aria-label="Internal release feedback"]';
const requestDetail='[aria-label="Selected release request"]',feedbackForm='[aria-label="Release feedback decision"]';
const internalWork='.panel-body.restricted-work',externalWork='main.restricted-work',published='[aria-label="Published instructions"]';

test('sandboxed recipient feedback: exact PDF receipt, corrected request, independently published response and revoked-release clearing',{timeout:180000},async()=>{
  const h=await recipientWorkBrowser(),{f,browser}=h;
  try{
    const q=await feedbackRelease(f),other=await f.member('client');
    const subject='Fictional released-copy clarification',initial='Please clarify the attributed wording in section one of this exact fictional released PDF.',corrected='Fictional request correction: explain the attribution in the released PDF section one only.';
    const secrets=[privateSource,q.hidden.evidenceId,q.hidden.claimId,f.caseId,f.investigator.id,f.reviewer.id,privateReviewReason,responseDraft];
    await h.navigate(other.headers,'/portal','main');await h.button('Refresh disclosures');await h.wait(`document.body.textContent.includes('No currently available disclosures.')`,'ungranted recipient has no releases');
    withoutSecrets(await h.text(),[q.release.id,q.pdf.pdfSha256,...secrets],'other recipient page');
    assert.equal((await f.call(q.external,undefined,other.headers)).statusCode,404);
    await h.navigate(f.client.headers,'/portal','main');await h.button('Refresh disclosures');
    await h.wait(`document.body.textContent.includes(${JSON.stringify(q.release.id)})`,'specific approved PDF release listed');
    await h.button('Verify and download snapshot');await h.wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Acknowledge receipt')`,'byte-verified download enables acknowledgement');
    await h.check('I confirm receipt of this exact deliverable.');await h.button('Acknowledge receipt');
    await h.wait(`document.body.textContent.includes('Receipt acknowledged at ')`,'recipient exact-copy acknowledgement');
    const ack=(await f.pool.query('SELECT * FROM report_disclosure_acknowledgements WHERE tenant_id=$1 AND disclosure_id=$2',[tenant,q.release.id])).rows;
    assert.equal(ack.length,1,'one retained acknowledgement');
    assert.equal(ack[0].recipient_id,f.client.id);assert.equal(ack[0].digest.trim(),q.pdf.pdfSha256);
    await h.button('Open release requests');await h.button('New clarification or change request',clientFeedback);
    await h.select('Request kind','change',feedbackForm);await h.fill('Subject',subject,feedbackForm);await h.fill('Request details',initial,feedbackForm);
    await h.check('I confirm this decision is for the recipient',feedbackForm);await h.button('Save feedback decision',feedbackForm);
    await h.wait(`document.querySelector(${JSON.stringify(requestDetail)})?.textContent.includes('request revision 1')`,'recipient request saved');
    const item=(await f.must<FeedbackRequestPage>(q.publicBase,undefined,f.client.headers)).items[0]!;
    assert.equal(item.release.sha256,q.pdf.pdfSha256);assert.equal(item.release.reportSha256,q.report.sha256);assert.equal(item.release.disclosureId,q.release.id);assert.equal(item.kind,'change');
    assert.equal((await f.call(q.publicBase+'/'+item.id,undefined,other.headers)).statusCode,404);
    await h.button('Correct request',clientFeedback);await h.fill('Request details',corrected,feedbackForm);
    await h.fill('Reason (visible to the recipient when applicable)','Fictional correction narrows the request to the released wording.',feedbackForm);await h.button('Save feedback decision',feedbackForm);
    await h.wait(`document.querySelector(${JSON.stringify(requestDetail)})?.textContent.includes('request revision 2 · text revision 2')`,'corrected request retained');
    await h.button('Request correction and state history',clientFeedback);await h.wait(`document.querySelectorAll('[aria-label="Request version history"] details').length===2`,'both request revisions retained');
    withoutSecrets(await h.text(),secrets,'recipient corrected request');await h.captures('feedback-recipient-request',clientFeedback);
    async function internal(session:typeof f.maker){
      await h.navigate(session,'/#case='+f.caseId+'&view=Reports','.feedback-release-list');await h.button('Refresh client request releases');
      await h.button('Open report_pdf feedback · '+q.release.id.slice(0,8));await h.button('Open request '+item.id.slice(0,8),internalFeedback);
      await h.wait(`document.querySelector(${JSON.stringify(requestDetail)})?.textContent.includes(${JSON.stringify(corrected)})`,'internal exact request desk');
    }
    await internal(f.investigator.headers);await h.button('Draft response',internalFeedback);
    await h.fill('Proposed recipient-visible response',responseDraft,feedbackForm);await h.fill('Reason (visible to the recipient when applicable)','Fictional draft awaits correction before any publication.',feedbackForm);await h.button('Save internal response draft',feedbackForm);
    await h.wait(`document.querySelector('[aria-label="Internal response drafting"]')?.textContent.includes('Draft revision 1')`,'unpublished response draft one');
    assert.equal(await browser.evaluate(`!![...document.querySelectorAll(${JSON.stringify(internalFeedback+' button')})].find(b=>b.textContent==='Independently review response')`),false,'response author cannot self-publish');
    const hidden=await f.must<FeedbackDetail>(q.publicBase+'/'+item.id,undefined,f.client.headers);assert.equal(hidden.responseDraft,null);assert.equal(hidden.request.latestResponse,null);withoutSecrets(hidden,secrets,'recipient DTO before publication');
    await h.navigate(f.client.headers,'/portal','main');await h.button('Refresh disclosures');await h.button('Open release requests');await h.button('Open request '+item.id.slice(0,8),clientFeedback);
    await h.wait(`document.querySelector(${JSON.stringify(requestDetail)})?.textContent.includes('No currently published response.')`,'draft not visible on recipient page');withoutSecrets(await h.text(),secrets,'unpublished browser response');
    await internal(f.investigator.headers);await h.button('Correct response in a new draft',internalFeedback);
    await h.fill('Proposed recipient-visible response',publishedResponse,feedbackForm);await h.fill('Reason (visible to the recipient when applicable)','Fictional correction removes the earlier unpublished wording.',feedbackForm);await h.button('Save internal response draft',feedbackForm);
    await h.wait(`document.querySelector('[aria-label="Internal response drafting"]')?.textContent.includes('Draft revision 2')`,'corrected unpublished draft two');
    const draft=await f.must<FeedbackDetail>(q.internal+'/'+item.id);
    await internal(f.reviewer.headers);await h.button('Independently review response',internalFeedback);
    await h.wait(`document.querySelector(${JSON.stringify(feedbackForm)})?.textContent.includes(${JSON.stringify(draft.responseDraft!.sha256)})`,'reviewer inspects exact proposed response hash');
    await h.fill('Internal independent review reason',privateReviewReason,feedbackForm);await h.check('I independently inspected this exact response',feedbackForm);
    await h.captures('feedback-independent-review',feedbackForm);await h.button('Publish reviewed response in portal',feedbackForm);
    await h.wait(`document.querySelector(${JSON.stringify(requestDetail)})?.textContent.includes('Published agency response v2')`,'independent response published');
    const publication=(await f.pool.query('SELECT actor_id,response_version FROM portal_feedback_publications WHERE tenant_id=$1 AND request_id=$2',[tenant,item.id])).rows;
    assert.deepEqual(publication,[{actor_id:f.reviewer.id,response_version:2}]);
    await h.navigate(f.client.headers,'/portal','main');await h.button('Refresh disclosures');await h.button('Open release requests');await h.button('Open request '+item.id.slice(0,8),clientFeedback);
    await h.wait(`document.querySelector(${JSON.stringify(requestDetail)})?.textContent.includes(${JSON.stringify(publishedResponse)})`,'recipient sees only approved response');
    const publicDetail=await f.must<FeedbackDetail>(q.publicBase+'/'+item.id,undefined,f.client.headers);
    assert.equal(publicDetail.responseDraft,null);assert.equal(publicDetail.request.latestResponse!.sha256,draft.responseDraft!.sha256);assert.equal(publicDetail.request.latestResponse!.requestContentVersion,2);
    withoutSecrets(publicDetail,secrets,'published recipient DTO');withoutSecrets(await h.text(),secrets,'published recipient page');
    await h.button('Mark request resolved',clientFeedback);await h.fill('Reason (visible to the recipient when applicable)','Fictional recipient explicitly considers the clarification resolved.',feedbackForm);await h.check('I explicitly mark this request resolved',feedbackForm);await h.button('Save feedback decision',feedbackForm);
    await h.wait(`document.querySelector(${JSON.stringify(requestDetail)})?.textContent.includes('change · resolved · request revision 3')`,'explicit resolution saved');
    assert.equal((await f.must<FeedbackDetail>(q.publicBase+'/'+item.id,undefined,f.client.headers)).request.state,'resolved');
    await h.button('Reopen request',clientFeedback);await h.fill('Reason (visible to the recipient when applicable)','Fictional recipient explicitly reopens the retained request for review.',feedbackForm);await h.check('I confirm this decision is for the recipient',feedbackForm);await h.button('Save feedback decision',feedbackForm);
    await h.wait(`document.querySelector(${JSON.stringify(requestDetail)})?.textContent.includes('unresolved · request revision 4')`,'explicit reopening saved');
    assert.equal((await f.must<FeedbackDetail>(q.publicBase+'/'+item.id,undefined,f.client.headers)).request.state,'unresolved');
    await h.button('Request correction and state history',clientFeedback);await h.button('Published response history',clientFeedback);
    await h.wait(`document.querySelectorAll('[aria-label="Request version history"] details').length===4&&document.querySelectorAll('[aria-label="Published response history"] details').length===1`,'retained decision histories');
    withoutSecrets(await h.text(),secrets,'recipient history');await h.captures('feedback-published-history',clientFeedback);
    assert.deepEqual((await f.call(q.external,undefined,f.client.headers)).rawPayload,q.bytes,'feedback never rewrites the released PDF');
    await f.must(f.base+'/disclosures/'+q.release.id+'/revoke',{reason:'Fictional release revoked during the loaded recipient feedback journey.'});
    assert.equal((await f.call(q.publicBase+'/'+item.id,undefined,f.client.headers)).statusCode,404);
    await h.button('Refresh release requests',clientFeedback);
    await h.wait(`!document.querySelector(${JSON.stringify(clientFeedback)})&&document.body.textContent.includes('Feedback access is no longer available.')`,'revoked release removes loaded feedback');
    withoutSecrets(await h.text(),[subject,initial,corrected,publishedResponse,item.id,q.release.id,q.pdf.pdfSha256,...secrets],'revoked recipient page');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM portal_feedback_request_revisions WHERE request_id=$1',[item.id])).rows[0].n,4);
    await h.captures('feedback-revoked','main');
  }catch(error){await h.failure('feedback',error);throw error;}finally{await h.close();}
});

test('sandboxed collaborator: independent versioned publication, acknowledgement/submission, review, handling and revocation privacy',{timeout:180000},async()=>{
  const h=await recipientWorkBrowser(),{f,browser}=h;
  try{
    const q=await collaboratorDraft(f),other=await f.member('client');
    const progress='Fictional progress: the packing checklist was read; one entry remains unclear.';
    const submission='Fictional submitted work: the checklist contains an unreadable final entry.';
    const correction='Fictional corrected submission: the unreadable entry remains explicitly unresolved.';
    const changes='Fictional public feedback: preserve the unreadable entry as an uncertainty.';
    const acceptance='Fictional public feedback: the declared uncertainty is accepted for internal task review.';
    const secrets=[privateTask,privateDraftReason,privateReviewReason,q.task.id,q.grant.draft.taskSha256,f.caseId,f.investigator.id,f.reviewer.id];
    async function openInternal(session:typeof f.maker){await h.navigate(session,'/#case='+f.caseId+'&view=Tasks',internalWork);await h.button(grantTitle,'.grant-register',true);await h.wait(`!!document.querySelector('[aria-label="Restricted grant detail"]')`,'internal saved grant');}
    async function publish(version:number){await openInternal(f.reviewer.headers);await h.fill('Internal decision reason',privateReviewReason,internalWork);await h.check('I inspected the exact version and recipient-visible content.',internalWork);await h.button('Independently publish instructions',internalWork);await h.wait(`document.querySelector('[aria-label="Restricted grant detail"]')?.textContent.includes(${JSON.stringify('Currently retained publication v'+version+' · published')})`,'independent instruction publication '+version);}
    async function recipient(){await h.navigate(f.client.headers,'/collaborator',externalWork);await h.button(grantTitle,'.grant-register',true);await h.wait(`!!document.querySelector(${JSON.stringify(published)})`,'published recipient instructions');}
    async function record(kind:'progress'|'submitted',body:string){await h.fill('Plain-text work / progress',body,externalWork);await h.fill('Reason for this record or correction','Fictional recipient records this version for internal review only.',externalWork);await h.check('This is a work declaration for review.',externalWork);await h.button(kind==='progress'?'Record progress / correction':'Submit for internal acceptance',externalWork);await h.wait(`document.querySelector('.grant-submission')?.textContent.includes(${JSON.stringify(body)})&&!document.querySelector('textarea').value`,'saved recipient '+kind);}
    await h.navigate(f.client.headers,'/collaborator',externalWork);await h.wait(`document.body.textContent.includes('No currently accessible work on this page.')`,'draft invisible to intended recipient');withoutSecrets(await h.text(),[grantTitle,instructions,...secrets],'draft-only recipient page');
    await openInternal(f.investigator.headers);
    assert.ok(await browser.evaluate<boolean>(`(${h.textElement('button','Independently publish instructions',internalWork)}).matches(':disabled')`),'instruction author cannot publish');
    await publish(1);
    const first=await f.must<ExternalWork>(q.external,undefined,f.client.headers);assert.equal(first.content.version,1);assert.equal(first.invitation,'pending');withoutSecrets(first,secrets,'published grant DTO');
    await h.navigate(other.headers,'/collaborator',externalWork);await h.wait(`document.body.textContent.includes('No currently accessible work on this page.')`,'ungranted recipient sees no assignment');withoutSecrets(await h.text(),[grantTitle,first.sha256,...secrets],'other recipient work page');
    assert.equal((await f.call(q.external,undefined,other.headers)).statusCode,404);
    await recipient();assert.ok((await h.text(published)).includes(first.sha256));await h.check('I have read these specific instructions and due date.',externalWork);await h.button('Accept assigned work',externalWork);await h.wait(`!!document.querySelector('textarea')`,'acknowledgement enables work declaration');
    await record('progress',progress);await record('submitted',submission);
    assert.equal((await f.must<ExternalWork>(q.external,undefined,f.client.headers)).submission!.sequence,2);
    assert.equal((await f.pool.query('SELECT status FROM case_work_items WHERE id=$1',[q.task.id])).rows[0].status,'To do','external submission cannot complete internal task');
    await h.button('Your submission and publication history',externalWork);await h.captures('collaborator-submitted',published);
    // Corrected drafts stay private until independently published, then require a fresh acknowledgement.
    await openInternal(f.investigator.headers);await h.button('Revise and rebind instructions',internalWork);
    await h.fill('Recipient-visible instructions',correctedInstructions,internalWork);await h.fill('Internal reason for draft version',privateDraftReason+' Corrected version two.',internalWork);await h.button('Save internal draft',internalWork);
    await h.wait(`document.querySelector('[aria-label="Restricted grant detail"]')?.textContent.includes('draft v2')`,'new private instruction version');
    const stillFirst=await f.must<ExternalWork>(q.external,undefined,f.client.headers);assert.equal(stillFirst.content.version,1);assert.equal(stillFirst.sha256,first.sha256);withoutSecrets(stillFirst,[correctedInstructions,...secrets],'unpublished instruction correction');
    await publish(2);await recipient();await h.wait(`document.querySelector(${JSON.stringify(published)})?.textContent.includes('Instructions v2')`,'new published instructions');
    assert.equal(await browser.evaluate('document.querySelectorAll("textarea").length'),0,'new instructions need another acknowledgement');
    const second=await f.must<ExternalWork>(q.external,undefined,f.client.headers);assert.notEqual(second.publication.id,first.publication.id);assert.notEqual(second.sha256,first.sha256);assert.equal(second.invitation,'pending');
    assert.equal((await f.call(q.external+'/invitation',{id:randomUUID(),publicationId:first.publication.id,sha256:first.sha256,decision:'accepted',confirmInstructions:true},f.client.headers)).statusCode,409,'stale publication cannot be acknowledged');
    await h.check('I have read these specific instructions and due date.',externalWork);await h.button('Accept assigned work',externalWork);await record('submitted',submission+' Under published version two.');
    async function review(decision:'changes_requested'|'accepted',feedback:string){await openInternal(f.reviewer.headers);await h.fill('Internal decision reason',privateReviewReason,internalWork);await h.fill('Recipient-visible acceptance / changes feedback',feedback,internalWork);await h.check('I inspected the exact version and recipient-visible content.',internalWork);await h.button(decision==='accepted'?'Reviewer: accept exact submission':'Reviewer: request changes',internalWork);await h.wait(`document.querySelector('[aria-label="Restricted grant detail"]')?.textContent.includes(${JSON.stringify('Internal decision: '+decision)})`,'internal review '+decision);}
    await review('changes_requested',changes);await recipient();await h.wait(`document.querySelector(${JSON.stringify(published)})?.textContent.includes(${JSON.stringify(changes)})`,'recipient sees public change feedback');
    await record('submitted',correction);await review('accepted',acceptance);await recipient();
    await h.wait(`document.querySelector(${JSON.stringify(published)})?.textContent.includes(${JSON.stringify(acceptance)})`,'recipient sees accepted exact submission');
    assert.equal(await browser.evaluate('document.querySelectorAll("textarea").length'),0,'accepted work cannot be silently resubmitted');
    const accepted=await f.must<ExternalWork>(q.external,undefined,f.client.headers);assert.equal(accepted.submission!.sequence,4);assert.equal(accepted.result!.submissionId,accepted.submission!.id);assert.equal(accepted.submission!.publicationId,second.publication.id);assert.equal(accepted.result!.decision,'accepted');
    assert.equal((await f.pool.query('SELECT status FROM case_work_items WHERE id=$1',[q.task.id])).rows[0].status,'To do','review acceptance still requires explicit internal task completion');
    await h.button('Your submission and publication history',externalWork);await h.wait(`!!document.querySelector('[aria-label="External work history"]')`,'recipient retained work history');
    withoutSecrets(await h.text(),secrets,'recipient approved work and history');withoutSecrets(await f.must(q.external+'/history',undefined,f.client.headers),secrets,'recipient history DTO');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.client.id])).rows[0].n,0,'grant never creates case membership');
    await h.captures('collaborator-accepted',published);
    await f.handling('internal_only');await h.button('Refresh assigned work',externalWork);
    await h.wait(`!document.querySelector(${JSON.stringify(published)})&&!document.querySelector('[aria-label="External work history"]')&&document.body.textContent.includes('No currently accessible work on this page.')`,'handling denial clears loaded external work');
    withoutSecrets(await h.text(),[grantTitle,correctedInstructions,progress,submission,correction,acceptance,first.sha256,second.sha256,...secrets],'handling-denied collaborator page');
    assert.equal((await f.call(q.external,undefined,f.client.headers)).statusCode,404);
    await h.captures('collaborator-handling-denied',externalWork);
    await f.handling('existing_release_controls');await h.button('Refresh assigned work',externalWork);await h.button(grantTitle,'.grant-register',true);await h.wait(`!!document.querySelector(${JSON.stringify(published)})`,'explicitly reenabled grant');await h.button('Your submission and publication history',externalWork);
    await f.must<InternalCollaboratorWork>(q.internal+'/revoke',{id:randomUUID(),reason:'Fictional internal revocation of the specific collaborator grant.'},f.investigator.headers);
    await h.button('Refresh assigned work',externalWork);await h.wait(`!document.querySelector(${JSON.stringify(published)})&&!document.querySelector('[aria-label="External work history"]')&&document.body.textContent.includes('No currently accessible work on this page.')`,'grant revocation clears loaded instructions and history');
    withoutSecrets(await h.text(),[grantTitle,correctedInstructions,progress,submission,correction,acceptance,second.sha256,...secrets],'revoked collaborator page');
    assert.equal((await f.call(q.external+'/history',undefined,f.client.headers)).statusCode,404);
    const retained=await f.must<InternalCollaboratorWork>(q.internal);assert.equal(retained.revoked,true);assert.equal(retained.submission!.sha256,accepted.submission!.sha256);
    await h.captures('collaborator-revoked',externalWork);
  }catch(error){await h.failure('collaborator',error);throw error;}finally{await h.close();}
});
