CREATE INDEX integrity_jobs_case_history_idx ON integrity_jobs (tenant_id,case_id,created_at DESC,id DESC);
CREATE INDEX integrity_job_events_history_idx ON integrity_job_events (tenant_id,case_id,job_id,id);
