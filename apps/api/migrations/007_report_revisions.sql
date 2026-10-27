CREATE TABLE report_revisions (
  tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
  created_by uuid NOT NULL, idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  report_bytes bytea NOT NULL CHECK (octet_length(report_bytes) BETWEEN 1 AND 33554432),
  digest char(64) NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (tenant_id,case_id,id),
  UNIQUE (tenant_id,case_id,created_by,idempotency_key),
  FOREIGN KEY (tenant_id,case_id) REFERENCES cases(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER report_revisions_append_only BEFORE UPDATE OR DELETE ON report_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON report_revisions TO inveos_app;
