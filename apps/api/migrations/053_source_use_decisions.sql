-- Source metadata review and permission to use that source are distinct decisions.
CREATE TABLE source_use_decisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,source_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 100),id uuid NOT NULL,
 source_version integer NOT NULL,source_digest char(64) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),
 snapshot jsonb NOT NULL,digest char(64) NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),request_hash char(64) NOT NULL,
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,source_id,sequence),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,source_id,source_version) REFERENCES manual_source_revisions(tenant_id,case_id,source_id,version)
);
CREATE TRIGGER source_use_decisions_immutable BEFORE UPDATE OR DELETE ON source_use_decisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON source_use_decisions TO inveos_app;
