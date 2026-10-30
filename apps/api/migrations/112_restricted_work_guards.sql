CREATE FUNCTION restricted_work_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g restricted_work_grants%ROWTYPE; d restricted_work_drafts%ROWTYPE; p restricted_work_publications%ROWTYPE; previous_sequence integer; w case_work_items%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 IF TG_TABLE_NAME='restricted_work_grants' THEN
  SELECT * INTO w FROM case_work_items WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.task_id;
  IF w.kind IS DISTINCT FROM 'task' OR w.status='Complete' OR NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND user_id=NEW.recipient_id AND role='client') THEN RAISE EXCEPTION 'Restricted grant requires a saved open task and restricted recipient' USING ERRCODE='55000'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO g FROM restricted_work_grants WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.grant_id;
 SELECT * INTO d FROM restricted_work_drafts WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO p FROM restricted_work_publications WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO w FROM case_work_items WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND id=g.task_id;
 IF TG_TABLE_NAME='restricted_work_drafts' THEN
  IF NEW.version<>COALESCE(d.version,0)+1 OR NEW.task_id<>g.task_id OR NEW.task_version<>w.version OR w.status='Complete' OR EXISTS(SELECT 1 FROM restricted_work_revocations WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id) THEN RAISE EXCEPTION 'Draft must bind the current open task and sequential grant history' USING ERRCODE='55000'; END IF;
 ELSIF TG_TABLE_NAME='restricted_work_publications' THEN
  IF NEW.sequence<>COALESCE(p.sequence,0)+1 OR NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=g.tenant_id AND user_id=NEW.actor_id AND role='reviewer') THEN RAISE EXCEPTION 'Publication requires sequential reviewer decisions' USING ERRCODE='55000'; END IF;
  IF NEW.action='published' AND (NEW.version<>d.version OR NEW.sha256<>d.sha256 OR d.task_version<>w.version OR w.status='Complete' OR EXISTS(SELECT 1 FROM restricted_work_drafts WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id AND actor_id=NEW.actor_id)) THEN RAISE EXCEPTION 'Publication requires an independent reviewer and current exact draft' USING ERRCODE='55000'; END IF;
  IF NEW.action='withdrawn' AND (p.action IS DISTINCT FROM 'published' OR NEW.version<>p.version OR NEW.sha256<>p.sha256) THEN RAISE EXCEPTION 'Withdrawal must identify the currently published instructions' USING ERRCODE='55000'; END IF;
 ELSIF TG_TABLE_NAME='restricted_work_invitations' THEN
  IF NEW.actor_id<>g.recipient_id OR NEW.publication_id IS DISTINCT FROM p.id OR p.action IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'Invitation decision requires the exact published recipient grant' USING ERRCODE='55000'; END IF;
 ELSIF TG_TABLE_NAME='restricted_work_submissions' THEN
  SELECT COALESCE(max(sequence),0) INTO previous_sequence FROM restricted_work_submissions WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id;
  IF NEW.sequence<>previous_sequence+1 OR NEW.actor_id<>g.recipient_id OR NEW.publication_id IS DISTINCT FROM p.id OR p.action IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'Submission requires sequential recipient records for the current publication' USING ERRCODE='55000'; END IF;
 ELSIF TG_TABLE_NAME='restricted_work_reviews' THEN
  SELECT COALESCE(max(sequence),0) INTO previous_sequence FROM restricted_work_reviews WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id;
  IF NEW.sequence<>previous_sequence+1 OR NEW.task_id<>g.task_id OR NEW.task_version<>w.version OR NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=g.tenant_id AND user_id=NEW.actor_id AND role='reviewer') THEN RAISE EXCEPTION 'Acceptance requires a current internal task and reviewer' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER restricted_work_grant_guard BEFORE INSERT ON restricted_work_grants FOR EACH ROW EXECUTE FUNCTION restricted_work_append_guard();
CREATE TRIGGER restricted_work_draft_guard BEFORE INSERT ON restricted_work_drafts FOR EACH ROW EXECUTE FUNCTION restricted_work_append_guard();
CREATE TRIGGER restricted_work_publication_guard BEFORE INSERT ON restricted_work_publications FOR EACH ROW EXECUTE FUNCTION restricted_work_append_guard();
CREATE TRIGGER restricted_work_invitation_guard BEFORE INSERT ON restricted_work_invitations FOR EACH ROW EXECUTE FUNCTION restricted_work_append_guard();
CREATE TRIGGER restricted_work_submission_guard BEFORE INSERT ON restricted_work_submissions FOR EACH ROW EXECUTE FUNCTION restricted_work_append_guard();
CREATE TRIGGER restricted_work_review_guard BEFORE INSERT ON restricted_work_reviews FOR EACH ROW EXECUTE FUNCTION restricted_work_append_guard();

-- Applies to existing single edits and batch task-status changes as well as future callers.
CREATE FUNCTION restricted_work_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='task' AND NEW.status='Complete' AND (OLD.status<>'Complete' OR (NEW.title,NEW.body,NEW.owner_id,NEW.due_date,NEW.parent_id) IS DISTINCT FROM (OLD.title,OLD.body,OLD.owner_id,OLD.due_date,OLD.parent_id)) AND EXISTS(
  SELECT 1 FROM restricted_work_grants g
  JOIN LATERAL(SELECT * FROM restricted_work_publications WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id ORDER BY sequence DESC LIMIT 1)p ON p.action='published'
  JOIN restricted_work_drafts d ON d.tenant_id=g.tenant_id AND d.case_id=g.case_id AND d.grant_id=g.id AND d.version=p.version
  LEFT JOIN LATERAL(SELECT * FROM restricted_work_submissions WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id ORDER BY sequence DESC LIMIT 1)s ON true
  LEFT JOIN LATERAL(SELECT * FROM restricted_work_reviews WHERE tenant_id=g.tenant_id AND case_id=g.case_id AND grant_id=g.id ORDER BY sequence DESC LIMIT 1)r ON true
  WHERE g.tenant_id=OLD.tenant_id AND g.case_id=OLD.case_id AND g.task_id=OLD.id
   AND NOT EXISTS(SELECT 1 FROM restricted_work_revocations x WHERE x.tenant_id=g.tenant_id AND x.case_id=g.case_id AND x.grant_id=g.id)
   AND NOT COALESCE((NEW.title,NEW.body,NEW.owner_id,NEW.due_date,NEW.parent_id) IS NOT DISTINCT FROM (OLD.title,OLD.body,OLD.owner_id,OLD.due_date,OLD.parent_id) AND d.task_version=OLD.version AND s.publication_id=p.id AND s.kind='submitted' AND r.submission_id=s.id AND r.submission_sha256=s.sha256 AND r.decision='accepted' AND r.task_version=OLD.version,false)
 ) THEN RAISE EXCEPTION 'Accept the exact external submissions for this task version, or explicitly withdraw/revoke their grants, before completing the task' USING ERRCODE='P0017'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER restricted_work_completion_guard BEFORE UPDATE ON case_work_items FOR EACH ROW EXECUTE FUNCTION restricted_work_completion_guard();
