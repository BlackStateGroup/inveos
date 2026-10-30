/** Executing supporting PostgreSQL contracts for the browser fixtures, not browser execution. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {FeedbackDetail,ExternalWork,InternalCollaboratorWork} from '@inveos/contracts';
import {workflowFixture,tenant,sha} from './workflow-fixture.js';
import {feedbackRelease,collaboratorDraft,withoutSecrets,privateSource,privateTask,privateDraftReason,privateReviewReason,correctedInstructions,publishedResponse} from './recipient-work-fixtures.js';

test('recipient browser fixture: reviewed PDF feedback binds distinct hashes and current request text, hides private review, revokes without rewriting bytes',{timeout:60000},async()=>{
  const f=await workflowFixture();try{
    const q=await feedbackRelease(f),other=await f.member('client'),request={id:randomUUID(),sha256:q.pdf.pdfSha256,reportSha256:q.report.sha256,kind:'change',subject:'Fictional PDF wording clarification',body:'Please clarify the attributed wording in this fictional released PDF.',confirmReleasedScope:true};
    assert.equal((await f.call(q.publicBase,{...request,sha256:q.report.sha256},f.client.headers)).statusCode,409,'report hash cannot replace copy hash');
    assert.equal((await f.call(q.publicBase,request,other.headers)).statusCode,404);
    await f.must(q.publicBase,request,f.client.headers);
    const publicPath=q.publicBase+'/'+request.id,internal=q.internal+'/'+request.id,identity={id:randomUUID(),sha256:q.pdf.pdfSha256,reportSha256:q.report.sha256,expectedVersion:1,reason:'Fictional explicit correction retained for this exact release.'};
    const corrected=await f.must<FeedbackDetail>(publicPath+'/corrections',{...identity,kind:'change',subject:request.subject,body:request.body+' Only section one.'},f.client.headers);assert.equal(corrected.request.contentVersion,2);
    const draft=await f.must<FeedbackDetail>(internal+'/response',{...identity,id:randomUUID(),expectedVersion:2,expectedResponseVersion:0,body:publishedResponse},f.investigator.headers);
    const proposed={...identity,id:randomUUID(),expectedVersion:2,responseVersion:1,responseSha256:draft.responseDraft!.sha256,expectedPublicationSequence:0,confirmRecipientVisible:true,reason:privateReviewReason};
    assert.equal((await f.call(internal+'/publish-response',proposed,f.investigator.headers)).statusCode,403);
    assert.equal((await f.must<FeedbackDetail>(publicPath,undefined,f.client.headers)).request.latestResponse,null);
    await f.must(internal+'/publish-response',proposed,f.reviewer.headers);
    const visible=await f.must<FeedbackDetail>(publicPath,undefined,f.client.headers);assert.equal(visible.responseDraft,null);assert.equal(visible.request.latestResponse!.sha256,draft.responseDraft!.sha256);
    withoutSecrets(visible,[privateSource,privateReviewReason,q.hidden.evidenceId,q.hidden.claimId,f.caseId,f.investigator.id,f.reviewer.id],'PDF feedback recipient DTO');
    const history=await f.must(publicPath+'/responses',undefined,f.client.headers);withoutSecrets(history,[privateReviewReason],'publication history');
    await f.must(publicPath+'/corrections',{...identity,id:randomUUID(),expectedVersion:2,kind:'change',subject:request.subject,body:request.body+' Now distinguish the two attributed statements.'},f.client.headers);
    assert.equal((await f.call(publicPath+'/resolve',{...identity,id:randomUUID(),expectedVersion:3,responsePublicationId:visible.request.latestResponse!.publicationId,confirmRecipientVisible:true},f.client.headers)).statusCode,409,'old response cannot resolve newly corrected request');
    assert.deepEqual((await f.call(q.external,undefined,f.client.headers)).rawPayload,q.bytes);
    await f.must(f.base+'/disclosures/'+q.release.id+'/revoke',{reason:'Fictional explicit release revocation for boundary acceptance.'});
    for(const path of [q.external,publicPath,publicPath+'/history',publicPath+'/responses'])assert.equal((await f.call(path,undefined,f.client.headers)).statusCode,404,path);
    assert.equal((await f.call(q.publicBase,request,f.client.headers)).statusCode,404,'old idempotent request does not bypass revoked release');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM portal_feedback_request_revisions WHERE request_id=$1',[request.id])).rows[0].n,3);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM portal_feedback_publications WHERE request_id=$1',[request.id])).rows[0].n,1);
  }finally{await f.close();}
});

test('collaborator browser fixture: exact publication requires new acknowledgement and current handling/session fences retained submission history',{timeout:60000},async()=>{
  const f=await workflowFixture();try{
    const q=await collaboratorDraft(f),other=await f.member('client');
    const publication={id:randomUUID(),version:1,sha256:q.grant.draft.sha256,expectedSequence:0,reason:privateReviewReason,confirmRecipientVisible:true};
    assert.equal((await f.call(q.internal+'/publish',publication,f.investigator.headers)).statusCode,403);
    await f.must(q.internal+'/publish',publication,f.reviewer.headers);
    const first=await f.must<ExternalWork>(q.external,undefined,f.client.headers);
    const invitation={id:randomUUID(),publicationId:first.publication.id,sha256:first.sha256,decision:'accepted',confirmInstructions:true};await f.must(q.external+'/invitation',invitation,f.client.headers);
    const revised=await f.must<InternalCollaboratorWork>(q.internal+'/drafts',{id:randomUUID(),expectedVersion:1,taskVersion:1,title:q.input.title,instructions:correctedInstructions,dueDate:q.input.dueDate,reason:privateDraftReason},f.investigator.headers);
    assert.equal((await f.must<ExternalWork>(q.external,undefined,f.client.headers)).sha256,first.sha256,'new unpublished draft cannot change public content');
    await f.must(q.internal+'/publish',{...publication,id:randomUUID(),version:2,sha256:revised.draft.sha256,expectedSequence:1},f.reviewer.headers);
    const second=await f.must<ExternalWork>(q.external,undefined,f.client.headers);assert.equal(second.content.version,2);assert.equal(second.invitation,'pending');
    assert.equal((await f.call(q.external+'/invitation',invitation,f.client.headers)).statusCode,409,'old accepted invitation cannot bypass new publication');
    const bind={publicationId:second.publication.id,sha256:second.sha256},submission={id:randomUUID(),...bind,expectedSequence:0,kind:'submitted',body:'Fictional recipient supplied a plain-text work declaration only.',reason:'Fictional submission against exactly published version two.',confirmNoEvidenceUpload:true};
    assert.equal((await f.call(q.external+'/submissions',submission,f.client.headers)).statusCode,409,'fresh acknowledgement required');
    await f.must(q.external+'/invitation',{...invitation,...bind,id:randomUUID()},f.client.headers);
    const submitted=await f.must<ExternalWork>(q.external+'/submissions',submission,f.client.headers);
    await f.must(q.internal+'/reviews',{id:randomUUID(),submissionId:submitted.submission!.id,sha256:submitted.submission!.sha256,publicationId:second.publication.id,taskVersion:1,expectedReviewSequence:0,decision:'accepted',feedback:'Fictional recipient-visible acceptance without private review notes.',reason:privateReviewReason,confirmRecipientVisible:true},f.reviewer.headers);
    assert.equal((await f.pool.query('SELECT status FROM case_work_items WHERE id=$1',[q.task.id])).rows[0].status,'To do');
    const secrets=[privateTask,privateDraftReason,privateReviewReason,q.task.id,q.grant.draft.taskSha256,f.caseId,f.investigator.id,f.reviewer.id];
    withoutSecrets(await f.must(q.external,undefined,f.client.headers),secrets,'external work');withoutSecrets(await f.must(q.external+'/history',undefined,f.client.headers),secrets,'external history');
    assert.equal((await f.call(q.external,undefined,other.headers)).statusCode,404);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.client.id])).rows[0].n,0);
    await f.handling('internal_only');for(const path of [q.external,q.external+'/history'])assert.equal((await f.call(path,undefined,f.client.headers)).statusCode,404);assert.equal((await f.call(q.external+'/submissions',submission,f.client.headers)).statusCode,404,'retry rechecks handling');
    await f.handling('existing_release_controls');await f.must(q.external,undefined,f.client.headers);
    await f.admin.query('UPDATE sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[tenant,f.client.id]);
    assert.equal((await f.call(q.external,undefined,f.client.headers)).statusCode,401);assert.equal((await f.call(q.external+'/submissions',submission,f.client.headers)).statusCode,401);
    const fresh=await f.session(f.client.id);await f.must(q.external,undefined,fresh);
    await f.must(q.internal+'/revoke',{id:randomUUID(),reason:'Fictional explicit grant revocation retaining submission history.'},f.investigator.headers);
    assert.equal((await f.call(q.external,undefined,fresh)).statusCode,404);assert.equal((await f.call(q.external+'/submissions',submission,fresh)).statusCode,404);
    const retained=await f.must<InternalCollaboratorWork>(q.internal);assert.equal(retained.revoked,true);assert.equal(retained.submission!.sha256,submitted.submission!.sha256);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM restricted_work_submissions WHERE grant_id=$1',[q.grant.id])).rows[0].n,1);
  }finally{await f.close();}
});

test('recipient acknowledgement rechecks session after case-lock wait and rolls back receipt plus audit on late revocation',{timeout:60000},async()=>{
  const f=await workflowFixture();try{
    const q=await feedbackRelease(f),path=q.external+'/acknowledge',input={sha256:q.pdf.pdfSha256,confirmReceipt:true};
    async function revokedWhileBlocked(sql:string,args:unknown[]){
      const session=await f.session(f.client.id),lock=await f.admin.connect();await lock.query('BEGIN');await lock.query(sql,args);const lockPid=(await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const pending=f.call(path,input,session);let settled=false;
      try{
        let blocked=false;
        for(let i=0;i<100;i++){
          const waiters=await f.admin.query('SELECT 1 FROM pg_locks w WHERE NOT w.granted AND $1::int=ANY(pg_blocking_pids(w.pid))',[lockPid]);
          if(waiters.rowCount){blocked=true;break;}await delay(10);
        }
        assert.ok(blocked,'acknowledgement must actually wait on this owned lock');
        const token=session.cookie.split(';')[0]!.slice('inveos_session='.length);await f.admin.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[sha(token)]);
        await lock.query('COMMIT');const response=await pending;settled=true;return response;
      }finally{await lock.query('ROLLBACK');lock.release();if(!settled)await pending;}
    }
    const failures:string[]=[];
    const early=await revokedWhileBlocked('SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,f.caseId]);
    if(early.statusCode!==401)failures.push('after case lock: '+early.statusCode);
    // Run the final-audit window only after the first denial left no receipt behind.
    if(early.statusCode===401){
      const key='fictional-recipient-ack-'+randomUUID();
      await f.admin.query(`CREATE FUNCTION wait_recipient_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='report.disclosure_acknowledged' THEN PERFORM pg_advisory_xact_lock(hashtextextended('${key}',0)); END IF; RETURN NEW; END $$;CREATE TRIGGER wait_recipient_ack BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_recipient_ack()`);
      const late=await revokedWhileBlocked('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
      if(late.statusCode!==401)failures.push('during final audit: '+late.statusCode);
    }
    assert.deepEqual(failures,[],'revoked sessions must not acknowledge copies');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[q.release.id])).rows[0].n,0);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE case_id=$1 AND action='report.disclosure_acknowledged'",[f.caseId])).rows[0].n,0);
    const fresh=await f.session(f.client.id),receipt=await f.must(path,input,fresh);assert.deepEqual(await f.must(path,input,fresh),receipt);
    const retry=await revokedWhileBlocked('SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,f.caseId]);assert.equal(retry.statusCode,401,'retained acknowledgement retry also needs a current session');
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[q.release.id])).rows[0].n,1);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE case_id=$1 AND action='report.disclosure_acknowledged'",[f.caseId])).rows[0].n,1);
  }finally{await f.close();}
});
