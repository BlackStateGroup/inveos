CREATE INDEX upload_case_history ON upload_reservations(tenant_id,case_id,created_at DESC,id DESC);
CREATE INDEX upload_owner_history ON upload_reservations(tenant_id,case_id,created_by,created_at DESC,id DESC);
