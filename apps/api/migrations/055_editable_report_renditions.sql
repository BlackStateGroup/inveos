CREATE TABLE report_editable_renditions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,revision_id uuid NOT NULL,id uuid NOT NULL,
 created_by uuid NOT NULL,idempotency_key uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source_report_digest char(64) NOT NULL,profile text NOT NULL,profile_digest char(64) NOT NULL,
 redaction_plan jsonb NOT NULL,redaction_digest char(64) NOT NULL,
 content_model jsonb NOT NULL,content_digest char(64) NOT NULL,
 docx_bytes bytea NOT NULL,docx_digest char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),
 UNIQUE(tenant_id,case_id,created_by,idempotency_key),
 FOREIGN KEY(tenant_id,case_id,revision_id) REFERENCES report_revisions(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
 CHECK(profile='inveos_report_docx_v1'),
 CHECK(source_report_digest ~ '^[a-f0-9]{64}$' AND profile_digest ~ '^[a-f0-9]{64}$' AND redaction_digest ~ '^[a-f0-9]{64}$' AND content_digest ~ '^[a-f0-9]{64}$' AND docx_digest ~ '^[a-f0-9]{64}$'),
 CHECK(octet_length(docx_bytes)>0 AND octet_length(docx_bytes)<=33554432)
);
CREATE INDEX report_editable_renditions_revision_idx ON report_editable_renditions(tenant_id,case_id,revision_id,created_at,id);
CREATE TRIGGER report_editable_renditions_append_only BEFORE UPDATE OR DELETE ON report_editable_renditions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON report_editable_renditions TO inveos_app;
