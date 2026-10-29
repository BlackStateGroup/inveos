CREATE TABLE manual_sources (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
 evidence_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 created_by uuid NOT NULL REFERENCES users(id), request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id)
);
CREATE TABLE manual_source_revisions (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, source_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100), snapshot jsonb NOT NULL,
 digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,source_id,version),
 FOREIGN KEY(tenant_id,case_id,source_id) REFERENCES manual_sources(tenant_id,case_id,id)
);
CREATE TABLE manual_source_reviews (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, source_id uuid NOT NULL, version integer NOT NULL,
 id uuid NOT NULL, digest char(64) NOT NULL, accepted boolean NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES users(id), reviewer_name text NOT NULL, reason text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,source_id,version), UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,source_id,version) REFERENCES manual_source_revisions(tenant_id,case_id,source_id,version)
);
CREATE TRIGGER manual_source_no_delete BEFORE DELETE ON manual_sources FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER manual_source_history_immutable BEFORE UPDATE OR DELETE ON manual_source_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER manual_source_review_immutable BEFORE UPDATE OR DELETE ON manual_source_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON manual_sources,manual_source_revisions,manual_source_reviews TO inveos_app;
GRANT UPDATE(version) ON manual_sources TO inveos_app;
