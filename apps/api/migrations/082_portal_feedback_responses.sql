-- Unpublished response drafts are internal. Only explicit publication records
-- make a particular text revision visible to the original disclosure recipient.
CREATE TABLE portal_feedback_response_revisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 request_content_version integer NOT NULL,action text NOT NULL CHECK(action IN ('drafted','corrected','withdrawn')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 10 AND 4000),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,request_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id) REFERENCES portal_feedback_requests(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id,request_content_version) REFERENCES portal_feedback_request_revisions(tenant_id,case_id,request_id,version),
 CHECK((action='drafted')=(version=1))
);
CREATE TABLE portal_feedback_publications (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 200),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 response_version integer NOT NULL,action text NOT NULL CHECK(action IN ('published','withdrawn')),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,request_id,sequence),UNIQUE(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,request_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id,response_version) REFERENCES portal_feedback_response_revisions(tenant_id,case_id,request_id,version)
);
CREATE UNIQUE INDEX portal_feedback_publish_once ON portal_feedback_publications(tenant_id,case_id,request_id,response_version) WHERE action='published';
ALTER TABLE portal_feedback_request_revisions ADD CONSTRAINT portal_feedback_resolution_publication_fk
 FOREIGN KEY(tenant_id,case_id,request_id,response_publication_id) REFERENCES portal_feedback_publications(tenant_id,case_id,request_id,id);
CREATE TRIGGER portal_feedback_response_revisions_immutable BEFORE UPDATE OR DELETE ON portal_feedback_response_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER portal_feedback_publications_immutable BEFORE UPDATE OR DELETE ON portal_feedback_publications FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION portal_feedback_response_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous portal_feedback_response_revisions%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO previous FROM portal_feedback_response_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous.version,0)+1 OR
 (NEW.action='withdrawn' AND (previous.version IS NULL OR previous.action='withdrawn' OR NEW.body IS DISTINCT FROM previous.body OR NEW.request_content_version IS DISTINCT FROM previous.request_content_version)) THEN
  RAISE EXCEPTION 'Response draft sequence or withdrawal lineage differs' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_feedback_response_sequence BEFORE INSERT ON portal_feedback_response_revisions FOR EACH ROW EXECUTE FUNCTION portal_feedback_response_sequence();
CREATE FUNCTION portal_feedback_publication_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous portal_feedback_publications%ROWTYPE; response portal_feedback_response_revisions%ROWTYPE; request portal_feedback_request_revisions%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO previous FROM portal_feedback_publications WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO response FROM portal_feedback_response_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id AND version=NEW.response_version;
 SELECT r.* INTO request FROM portal_feedback_requests h JOIN portal_feedback_request_revisions r ON r.tenant_id=h.tenant_id AND r.case_id=h.case_id AND r.request_id=h.id AND r.version=h.version WHERE h.tenant_id=NEW.tenant_id AND h.case_id=NEW.case_id AND h.id=NEW.request_id;
 IF NEW.sequence<>COALESCE(previous.sequence,0)+1 OR response.sha256 IS DISTINCT FROM NEW.sha256 OR
 (NEW.action='withdrawn' AND (previous.action IS DISTINCT FROM 'published' OR previous.response_version<>NEW.response_version)) OR
 (NEW.action='published' AND (response.action='withdrawn' OR response.request_content_version<>request.content_version OR request.state<>'unresolved' OR
 EXISTS(SELECT 1 FROM portal_feedback_response_revisions r WHERE r.tenant_id=NEW.tenant_id AND r.case_id=NEW.case_id AND r.request_id=NEW.request_id AND (r.version>NEW.response_version OR r.actor_id=NEW.actor_id)))) OR
 NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.actor_id AND m.role='reviewer' AND cm.case_id=NEW.case_id) THEN
  RAISE EXCEPTION 'Publication requires an independent current reviewer and the exact current response; withdrawal names the visible response' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_feedback_publication_sequence BEFORE INSERT ON portal_feedback_publications FOR EACH ROW EXECUTE FUNCTION portal_feedback_publication_sequence();
GRANT SELECT,INSERT ON portal_feedback_response_revisions,portal_feedback_publications TO inveos_app;
