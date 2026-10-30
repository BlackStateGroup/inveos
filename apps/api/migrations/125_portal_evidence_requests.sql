-- Explicit recipient capability, without case membership or automatic delivery.
CREATE TABLE portal_evidence_requests (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,recipient_id uuid NOT NULL REFERENCES users(id),recipient_name text NOT NULL,
 authority_version integer NOT NULL,expires_at timestamptz NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 request_hash char(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '90 days')
);
CREATE INDEX portal_evidence_recipient ON portal_evidence_requests(tenant_id,recipient_id,id);
CREATE TABLE portal_evidence_drafts (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL,content jsonb NOT NULL,sha256 char(64) NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tenant_id,case_id,request_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id) REFERENCES portal_evidence_requests(tenant_id,case_id,id),
 CHECK(content->>'format'='inveos_portal_evidence_request_v1'),CHECK(content->>'requestId'=request_id::text),CHECK((content->>'version')::integer=version)
);
CREATE TABLE portal_evidence_publications (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 200),
 version integer NOT NULL,sha256 char(64) NOT NULL,action text NOT NULL CHECK(action IN ('published','withdrawn','revoked')),
 request_hash char(64) NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,request_id,sequence),UNIQUE(tenant_id,case_id,request_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id,version) REFERENCES portal_evidence_drafts(tenant_id,case_id,request_id,version)
);
CREATE TABLE portal_evidence_responses (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,publication_id uuid NOT NULL,id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 100),state text NOT NULL CHECK(state IN ('submitted','withdrawn')),
 body text NOT NULL CHECK(length(body)<=6000),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 publication_sha256 char(64) NOT NULL,sha256 char(64) NOT NULL,request_hash char(64) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tenant_id,case_id,id),
 UNIQUE(tenant_id,case_id,request_id,publication_id,sequence),UNIQUE(tenant_id,case_id,request_id,publication_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id,publication_id) REFERENCES portal_evidence_publications(tenant_id,case_id,request_id,id)
);
CREATE TRIGGER portal_evidence_request_immutable BEFORE UPDATE OR DELETE ON portal_evidence_requests FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER portal_evidence_draft_immutable BEFORE UPDATE OR DELETE ON portal_evidence_drafts FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER portal_evidence_publication_immutable BEFORE UPDATE OR DELETE ON portal_evidence_publications FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER portal_evidence_response_immutable BEFORE UPDATE OR DELETE ON portal_evidence_responses FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON portal_evidence_requests,portal_evidence_drafts,portal_evidence_publications,portal_evidence_responses TO inveos_app;
