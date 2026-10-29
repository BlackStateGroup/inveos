CREATE TABLE document_citation_candidates (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, job_id uuid NOT NULL, id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 selection jsonb NOT NULL, citation_bytes bytea NOT NULL CHECK(octet_length(citation_bytes) BETWEEN 1 AND 32768),
 citation_digest char(64) NOT NULL CHECK(citation_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,case_id,job_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id) REFERENCES document_derivatives(tenant_id,case_id,job_id)
);
CREATE TRIGGER document_citation_candidates_append_only BEFORE UPDATE OR DELETE ON document_citation_candidates
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON document_citation_candidates TO inveos_app;
