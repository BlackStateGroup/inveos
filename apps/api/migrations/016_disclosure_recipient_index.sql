CREATE INDEX disclosure_recipient_history ON report_disclosures(tenant_id,recipient_id,created_at DESC,id DESC);
