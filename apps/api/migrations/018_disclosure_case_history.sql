CREATE INDEX disclosure_case_history ON report_disclosures(tenant_id,case_id,created_at DESC,id DESC);
