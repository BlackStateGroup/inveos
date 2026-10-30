-- A recipient-authored request binds one immutable disclosure, never a live report.
ALTER TABLE report_disclosures ADD UNIQUE(tenant_id,case_id,id,revision_id,recipient_id);
CREATE TABLE portal_feedback_requests (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,disclosure_id uuid NOT NULL,
 revision_id uuid NOT NULL,recipient_id uuid NOT NULL,delivery_digest char(64) NOT NULL CHECK(delivery_digest ~ '^[a-f0-9]{64}$'),
 report_digest char(64) NOT NULL CHECK(report_digest ~ '^[a-f0-9]{64}$'),
 deliverable text NOT NULL CHECK(deliverable IN ('report_json','document_package','report_pdf','report_docx')),rendition_id uuid,
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,disclosure_id,id),
 FOREIGN KEY(tenant_id,case_id,disclosure_id,revision_id,recipient_id) REFERENCES report_disclosures(tenant_id,case_id,id,revision_id,recipient_id),
 CHECK((rendition_id IS NOT NULL)=(deliverable IN ('report_pdf','report_docx')))
);
CREATE TABLE portal_feedback_request_revisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 content_version integer NOT NULL CHECK(content_version BETWEEN 1 AND version),
 action text NOT NULL CHECK(action IN ('requested','corrected','withdrawn','resolved','reopened')),
 state text NOT NULL CHECK(state IN ('unresolved','resolved','withdrawn')),
 kind text NOT NULL CHECK(kind IN ('clarification','change')),
 subject text NOT NULL CHECK(length(btrim(subject)) BETWEEN 3 AND 150),body text NOT NULL CHECK(length(btrim(body)) BETWEEN 10 AND 4000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_kind text NOT NULL CHECK(actor_kind IN ('recipient','agency')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),response_publication_id uuid,
 PRIMARY KEY(tenant_id,case_id,request_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id) REFERENCES portal_feedback_requests(tenant_id,case_id,id),
 CHECK((action='requested')=(version=1)),CHECK((action IN ('requested','corrected'))=(content_version=version)),
 CHECK((action='withdrawn')=(state='withdrawn')),CHECK((action='resolved')=(state='resolved')),
 CHECK((action='resolved')=(response_publication_id IS NOT NULL))
);
ALTER TABLE portal_feedback_requests ADD CONSTRAINT portal_feedback_request_current_fk FOREIGN KEY(tenant_id,case_id,id,version)
 REFERENCES portal_feedback_request_revisions(tenant_id,case_id,request_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX portal_feedback_requests_disclosure ON portal_feedback_requests(tenant_id,disclosure_id,id);
CREATE TRIGGER portal_feedback_requests_no_delete BEFORE DELETE ON portal_feedback_requests FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER portal_feedback_request_revisions_immutable BEFORE UPDATE OR DELETE ON portal_feedback_request_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION portal_feedback_request_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 OR
 EXISTS(SELECT 1 FROM portal_feedback_request_revisions WHERE tenant_id=OLD.tenant_id AND case_id=OLD.case_id AND request_id=OLD.id AND version=OLD.version AND state='withdrawn')) THEN
  RAISE EXCEPTION 'Feedback identity is immutable and withdrawal is terminal' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_feedback_request_head BEFORE INSERT OR UPDATE ON portal_feedback_requests FOR EACH ROW EXECUTE FUNCTION portal_feedback_request_head();
CREATE FUNCTION portal_feedback_request_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous portal_feedback_request_revisions%ROWTYPE; recipient uuid;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT recipient_id INTO recipient FROM portal_feedback_requests WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.request_id;
 SELECT * INTO previous FROM portal_feedback_request_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous.version,0)+1 OR previous.state='withdrawn' OR
 (NEW.actor_kind='recipient' AND NEW.actor_id IS DISTINCT FROM recipient) OR
 (NEW.action IN ('requested','corrected','withdrawn') AND NEW.actor_kind<>'recipient') OR
 (NEW.action='resolved' AND previous.state<>'unresolved') OR (NEW.action='reopened' AND previous.state<>'resolved') OR
 (NEW.action IN ('resolved','reopened','withdrawn') AND (NEW.kind IS DISTINCT FROM previous.kind OR NEW.subject IS DISTINCT FROM previous.subject OR NEW.body IS DISTINCT FROM previous.body OR NEW.content_version IS DISTINCT FROM previous.content_version)) THEN
  RAISE EXCEPTION 'Feedback revisions must preserve recipient authorship and sequential state history' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_feedback_request_sequence BEFORE INSERT ON portal_feedback_request_revisions FOR EACH ROW EXECUTE FUNCTION portal_feedback_request_sequence();
GRANT SELECT,INSERT ON portal_feedback_requests,portal_feedback_request_revisions TO inveos_app;
GRANT UPDATE(version) ON portal_feedback_requests TO inveos_app;
