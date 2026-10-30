-- Tombstones serialize with late batch/cancellation requests under the same case lock.
CREATE TABLE processing_request_withdrawals (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,requested_by uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('queue','cancel')),
 request_sha256 char(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id,operation),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,requested_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER processing_request_withdrawals_immutable BEFORE UPDATE OR DELETE ON processing_request_withdrawals FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON processing_request_withdrawals TO inveos_app;
