-- Add a typed source to the existing append-only case reasoning links.
ALTER TABLE case_work_links ALTER COLUMN claim_id DROP NOT NULL;
ALTER TABLE case_work_links ADD COLUMN document_finding_id uuid;
ALTER TABLE case_work_links ADD CONSTRAINT work_link_exactly_one_source
 CHECK ((claim_id IS NOT NULL)::int + (document_finding_id IS NOT NULL)::int = 1);
ALTER TABLE case_work_links ADD CONSTRAINT work_link_document_scope
 FOREIGN KEY (tenant_id,case_id,document_finding_id) REFERENCES document_findings(tenant_id,case_id,id);
CREATE UNIQUE INDEX work_link_document_identity ON case_work_links(tenant_id,case_id,item_id,document_finding_id,relation)
 WHERE document_finding_id IS NOT NULL;
ALTER TABLE case_work_revisions ADD COLUMN source_links jsonb;
CREATE TABLE case_work_link_withdrawals (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, link_id uuid NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 3000),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,link_id),
 FOREIGN KEY(tenant_id,case_id,link_id) REFERENCES case_work_links(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER case_work_link_withdrawals_append_only BEFORE UPDATE OR DELETE ON case_work_link_withdrawals
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON case_work_link_withdrawals TO inveos_app;
