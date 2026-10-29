-- Case-scoped candidate scan; live leases are filtered at claim time.
CREATE INDEX integrity_jobs_dispatch_candidates ON integrity_jobs (tenant_id,case_id,created_at,id)
  WHERE status IN ('queued','running');
