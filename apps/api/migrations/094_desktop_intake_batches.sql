CREATE TABLE desktop_intake_batches (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 authority_version integer NOT NULL,request_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TABLE desktop_intake_entries (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,batch_id uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 19),
 request_key uuid NOT NULL,metadata jsonb NOT NULL,byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 262144),
 PRIMARY KEY(tenant_id,case_id,batch_id,ordinal),UNIQUE(tenant_id,case_id,request_key),
 FOREIGN KEY(tenant_id,case_id,batch_id) REFERENCES desktop_intake_batches(tenant_id,case_id,id)
);
CREATE TRIGGER desktop_intake_batches_immutable BEFORE UPDATE OR DELETE ON desktop_intake_batches FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER desktop_intake_entries_immutable BEFORE UPDATE OR DELETE ON desktop_intake_entries FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON desktop_intake_batches,desktop_intake_entries TO inveos_app;
