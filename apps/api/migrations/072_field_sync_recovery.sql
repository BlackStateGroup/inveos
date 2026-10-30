CREATE TABLE field_recovery_requests (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,user_id uuid NOT NULL,
 capture_id uuid NOT NULL,source_device_id uuid NOT NULL,manifest jsonb NOT NULL,
 manifest_sha256 char(64) NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 target jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id,source_device_id) REFERENCES field_devices(tenant_id,user_id,id)
);
CREATE INDEX field_recovery_capture ON field_recovery_requests(tenant_id,case_id,user_id,capture_id);
CREATE TABLE field_recovery_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approve','reject')),reviewer_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,request_id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id) REFERENCES field_recovery_requests(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,reviewer_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE field_sync_receipts (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,capture_id uuid NOT NULL,
 acceptance jsonb NOT NULL,recovery_id uuid,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,capture_id),
 FOREIGN KEY(tenant_id,case_id,capture_id) REFERENCES field_captures(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,recovery_id) REFERENCES field_recovery_requests(tenant_id,case_id,id)
);
CREATE TRIGGER field_recovery_requests_immutable BEFORE UPDATE OR DELETE ON field_recovery_requests FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER field_recovery_reviews_immutable BEFORE UPDATE OR DELETE ON field_recovery_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER field_sync_receipts_immutable BEFORE UPDATE OR DELETE ON field_sync_receipts FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON field_recovery_requests,field_recovery_reviews,field_sync_receipts TO inveos_app;
