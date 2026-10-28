CREATE INDEX sessions_active_owner ON sessions(tenant_id,user_id,id) WHERE revoked_at IS NULL;
