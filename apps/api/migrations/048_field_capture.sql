CREATE TABLE field_devices (
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,id uuid NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 3 AND 100),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,user_id,id),FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE field_device_revocations (
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,device_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,user_id,device_id),FOREIGN KEY(tenant_id,user_id,device_id) REFERENCES field_devices(tenant_id,user_id,id)
);
CREATE TABLE field_captures (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 user_id uuid NOT NULL,device_id uuid NOT NULL,evidence_id uuid NOT NULL,
 authority_id uuid NOT NULL,authority_version integer NOT NULL,
 manifest jsonb NOT NULL,manifest_sha256 char(64) NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,evidence_id),
 FOREIGN KEY(tenant_id,user_id,device_id) REFERENCES field_devices(tenant_id,user_id,id),
 FOREIGN KEY(tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,authority_id,authority_version) REFERENCES authority_records(tenant_id,case_id,id,version)
);
CREATE TRIGGER field_devices_immutable BEFORE UPDATE OR DELETE ON field_devices FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER field_device_revocations_immutable BEFORE UPDATE OR DELETE ON field_device_revocations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER field_captures_immutable BEFORE UPDATE OR DELETE ON field_captures FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON field_devices,field_device_revocations,field_captures TO inveos_app;

GRANT UPDATE ON field_devices TO inveos_app; -- Row locking only; immutable trigger rejects mutation.
