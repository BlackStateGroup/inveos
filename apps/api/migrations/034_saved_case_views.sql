CREATE TABLE saved_case_views (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, owner_id uuid NOT NULL, id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,case_id,owner_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE saved_case_view_revisions (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, owner_id uuid NOT NULL, view_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100), snapshot jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,owner_id,view_id,version),
 FOREIGN KEY(tenant_id,case_id,owner_id,view_id) REFERENCES saved_case_views(tenant_id,case_id,owner_id,id)
);
CREATE TRIGGER saved_view_history_immutable BEFORE UPDATE OR DELETE ON saved_case_view_revisions
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER saved_view_no_delete BEFORE DELETE ON saved_case_views
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON saved_case_views TO inveos_app;
GRANT UPDATE(version) ON saved_case_views TO inveos_app;
GRANT SELECT,INSERT ON saved_case_view_revisions TO inveos_app;
