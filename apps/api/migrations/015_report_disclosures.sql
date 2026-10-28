CREATE TABLE report_disclosures (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,revision_id uuid NOT NULL,
 recipient_id uuid NOT NULL,created_by uuid NOT NULL,idempotency_key uuid NOT NULL,
 authority_version integer NOT NULL,digest char(64) NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,case_id,created_by,idempotency_key),
 FOREIGN KEY(tenant_id,case_id,revision_id) REFERENCES report_revisions(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version)
);
CREATE TABLE report_disclosure_revocations (
 tenant_id uuid NOT NULL,disclosure_id uuid NOT NULL,revoked_by uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tenant_id,disclosure_id),
 FOREIGN KEY(tenant_id,disclosure_id) REFERENCES report_disclosures(tenant_id,id)
);
CREATE TRIGGER disclosure_append_only BEFORE UPDATE OR DELETE ON report_disclosures FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER disclosure_revocation_append_only BEFORE UPDATE OR DELETE ON report_disclosure_revocations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON report_disclosures,report_disclosure_revocations TO inveos_app;
