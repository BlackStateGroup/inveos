-- Immutable, bounded rule suggestions. No suggestion is a finding or release.
CREATE TABLE case_analysis_runs (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 authority_version integer NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL,request_hash char(64) NOT NULL,
 snapshot jsonb NOT NULL CHECK(octet_length(snapshot::text)<=262144),
 digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TABLE case_analysis_sources (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,run_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
 text_finding_id uuid,document_finding_id uuid,transcript_finding_id uuid,speech_finding_id uuid,
 PRIMARY KEY(tenant_id,case_id,run_id,ordinal),
 FOREIGN KEY(tenant_id,case_id,run_id) REFERENCES case_analysis_runs(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,text_finding_id) REFERENCES findings(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,document_finding_id) REFERENCES document_findings(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,transcript_finding_id) REFERENCES transcript_findings(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,speech_finding_id) REFERENCES speech_findings(tenant_id,case_id,id),
 CHECK(num_nonnulls(text_finding_id,document_finding_id,transcript_finding_id,speech_finding_id)=1)
);
CREATE TABLE case_analysis_decisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,run_id uuid NOT NULL,
 suggestion integer NOT NULL CHECK(suggestion BETWEEN 0 AND 39),version integer NOT NULL CHECK(version BETWEEN 1 AND 100),id uuid NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('request_check','dismiss')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,run_id,suggestion,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,run_id) REFERENCES case_analysis_runs(tenant_id,case_id,id)
);
CREATE TRIGGER case_analysis_runs_immutable BEFORE UPDATE OR DELETE ON case_analysis_runs FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER case_analysis_sources_immutable BEFORE UPDATE OR DELETE ON case_analysis_sources FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER case_analysis_decisions_immutable BEFORE UPDATE OR DELETE ON case_analysis_decisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON case_analysis_runs,case_analysis_sources,case_analysis_decisions TO inveos_app;
