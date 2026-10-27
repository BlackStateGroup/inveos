CREATE INDEX upload_expiry_candidates ON upload_reservations(tenant_id,case_id,expires_at,id) WHERE status='open';
