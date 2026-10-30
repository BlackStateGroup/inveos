-- Human-initiated question from an exact independently triaged suggestion.
CREATE TABLE case_analysis_followups (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,run_id uuid NOT NULL,suggestion integer NOT NULL,
 decision_version integer NOT NULL,work_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 request_hash char(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,run_id,suggestion),UNIQUE(tenant_id,case_id,work_id),
 FOREIGN KEY(tenant_id,case_id,run_id,suggestion,decision_version) REFERENCES case_analysis_decisions(tenant_id,case_id,run_id,suggestion,version),
 FOREIGN KEY(tenant_id,case_id,work_id) REFERENCES case_work_items(tenant_id,case_id,id)
);
CREATE TRIGGER case_analysis_followups_immutable BEFORE UPDATE OR DELETE ON case_analysis_followups FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON case_analysis_followups TO inveos_app;
