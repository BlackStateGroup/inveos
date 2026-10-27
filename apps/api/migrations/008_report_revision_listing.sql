CREATE INDEX report_revisions_case_order_idx ON report_revisions (tenant_id,case_id,created_at DESC,id DESC);
