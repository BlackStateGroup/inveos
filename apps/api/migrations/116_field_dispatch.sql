CREATE TABLE field_dispatch_versions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,dispatch_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,publisher_id uuid NOT NULL,recipient_id uuid NOT NULL,task_id uuid NOT NULL,task_version integer NOT NULL,
 authority_id uuid NOT NULL,authority_version integer NOT NULL,access_version integer NOT NULL,
 request_sha256 char(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),snapshot jsonb NOT NULL,
 published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,dispatch_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,task_id,task_version) REFERENCES case_work_revisions(tenant_id,case_id,item_id,version),
 FOREIGN KEY(tenant_id,case_id,authority_id,authority_version) REFERENCES authority_records(tenant_id,case_id,id,version),
 FOREIGN KEY(tenant_id,publisher_id) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES memberships(tenant_id,user_id),CHECK(publisher_id<>recipient_id)
);
CREATE TRIGGER field_dispatch_versions_immutable BEFORE UPDATE OR DELETE ON field_dispatch_versions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON field_dispatch_versions TO inveos_app;
