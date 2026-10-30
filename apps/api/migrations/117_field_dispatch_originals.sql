-- Operational originals are intentionally separate from evidence, claims and findings.
CREATE TABLE field_dispatch_originals (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,user_id uuid NOT NULL,device_id uuid NOT NULL,
 object_path text NOT NULL,manifest jsonb NOT NULL,manifest_sha256 char(64) NOT NULL,
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 262144),
 receipt jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(object_path),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id,device_id) REFERENCES field_devices(tenant_id,user_id,id)
);
CREATE TABLE field_dispatch_records (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,capture_id uuid NOT NULL,user_id uuid NOT NULL,
 dispatch_id uuid NOT NULL,dispatch_version integer NOT NULL,record_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),previous_capture_id uuid,
 request_id uuid NOT NULL,request_sha256 char(64) NOT NULL,receipt jsonb NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,capture_id),UNIQUE(tenant_id,case_id,request_id),UNIQUE(tenant_id,case_id,record_id,version),
 FOREIGN KEY(tenant_id,case_id,capture_id) REFERENCES field_dispatch_originals(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,dispatch_id,dispatch_version) REFERENCES field_dispatch_versions(tenant_id,case_id,dispatch_id,version),
 FOREIGN KEY(tenant_id,case_id,previous_capture_id) REFERENCES field_dispatch_records(tenant_id,case_id,capture_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX field_dispatch_record_history ON field_dispatch_records(tenant_id,case_id,dispatch_id,dispatch_version,applied_at);
CREATE TRIGGER field_dispatch_originals_immutable BEFORE UPDATE OR DELETE ON field_dispatch_originals FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER field_dispatch_records_immutable BEFORE UPDATE OR DELETE ON field_dispatch_records FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON field_dispatch_originals,field_dispatch_records TO inveos_app;
