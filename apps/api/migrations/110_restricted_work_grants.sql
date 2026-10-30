-- Explicit task capability for an existing restricted principal; never case membership.
CREATE TABLE restricted_work_grants (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,task_id uuid NOT NULL,recipient_id uuid NOT NULL REFERENCES users(id),
 recipient_name text NOT NULL,authority_version integer NOT NULL,expires_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,task_id) REFERENCES case_work_items(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),CHECK(expires_at>created_at)
);
CREATE INDEX restricted_work_recipient ON restricted_work_grants(tenant_id,recipient_id,id);
CREATE TABLE restricted_work_drafts (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,grant_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL,task_id uuid NOT NULL,task_version integer NOT NULL,task_sha256 char(64) NOT NULL,
 content jsonb NOT NULL,sha256 char(64) NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,grant_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,grant_id) REFERENCES restricted_work_grants(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,task_id,task_version) REFERENCES case_work_revisions(tenant_id,case_id,item_id,version),
 CHECK(content->>'format'='inveos_restricted_work_v1'),CHECK(content->>'grantId'=grant_id::text),CHECK((content->>'version')::int=version)
);
CREATE TABLE restricted_work_publications (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,grant_id uuid NOT NULL,id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 200),
 version integer NOT NULL,action text NOT NULL CHECK(action IN ('published','withdrawn')),sha256 char(64) NOT NULL,request_hash char(64) NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,grant_id,sequence),UNIQUE(tenant_id,case_id,grant_id,id),
 FOREIGN KEY(tenant_id,case_id,grant_id,version) REFERENCES restricted_work_drafts(tenant_id,case_id,grant_id,version)
);
CREATE TABLE restricted_work_revocations (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,grant_id uuid NOT NULL,id uuid NOT NULL,request_hash char(64) NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,grant_id),UNIQUE(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id,grant_id) REFERENCES restricted_work_grants(tenant_id,case_id,id)
);
CREATE TABLE restricted_work_invitations (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,grant_id uuid NOT NULL,publication_id uuid NOT NULL,id uuid NOT NULL,request_hash char(64) NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accepted','declined')),actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,publication_id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,grant_id,publication_id) REFERENCES restricted_work_publications(tenant_id,case_id,grant_id,id)
);
CREATE TRIGGER restricted_work_grant_immutable BEFORE UPDATE OR DELETE ON restricted_work_grants FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER restricted_work_draft_immutable BEFORE UPDATE OR DELETE ON restricted_work_drafts FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER restricted_work_publication_immutable BEFORE UPDATE OR DELETE ON restricted_work_publications FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER restricted_work_revocation_immutable BEFORE UPDATE OR DELETE ON restricted_work_revocations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER restricted_work_invitation_immutable BEFORE UPDATE OR DELETE ON restricted_work_invitations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON restricted_work_grants,restricted_work_drafts,restricted_work_publications,restricted_work_revocations,restricted_work_invitations TO inveos_app;
