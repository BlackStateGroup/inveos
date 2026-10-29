-- Alleged events remain distinct from reviewed findings and from source timestamps.
CREATE TABLE chronology_events (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 request_hash char(64) NOT NULL, created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE chronology_revisions (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, event_id uuid NOT NULL, version integer NOT NULL CHECK(version > 0),
 snapshot jsonb NOT NULL, actor_id uuid NOT NULL, actor_name text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 3000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,event_id,version),
 FOREIGN KEY(tenant_id,case_id,event_id) REFERENCES chronology_events(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER chronology_revisions_append_only BEFORE UPDATE OR DELETE ON chronology_revisions
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT,UPDATE ON chronology_events TO inveos_app;
GRANT SELECT,INSERT ON chronology_revisions TO inveos_app;
