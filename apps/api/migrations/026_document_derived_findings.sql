CREATE TABLE document_claims (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, job_id uuid NOT NULL, citation_id uuid NOT NULL, id uuid NOT NULL,
 text text NOT NULL CHECK(octet_length(text) BETWEEN 1 AND 8000),
 citation_digest char(64) NOT NULL CHECK(citation_digest ~ '^[a-f0-9]{64}$'),
 correspondence_review_id uuid NOT NULL, correspondence_review_digest char(64) NOT NULL CHECK(correspondence_review_digest ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_bytes bytea NOT NULL CHECK(octet_length(claim_bytes) BETWEEN 1 AND 16384), claim_digest char(64) NOT NULL CHECK(claim_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,case_id,job_id,citation_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id) REFERENCES document_citation_candidates(tenant_id,case_id,job_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id,correspondence_review_id)
   REFERENCES document_citation_reviews(tenant_id,case_id,job_id,citation_id,id)
);
CREATE TRIGGER document_claims_append_only BEFORE UPDATE OR DELETE ON document_claims
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TABLE document_claim_decisions (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, job_id uuid NOT NULL, citation_id uuid NOT NULL, claim_id uuid NOT NULL, id uuid NOT NULL,
 accepted boolean NOT NULL, reason text NOT NULL CHECK(octet_length(reason) BETWEEN 1 AND 6000),
 reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL,
 decision_bytes bytea NOT NULL CHECK(octet_length(decision_bytes) BETWEEN 1 AND 16384), decision_digest char(64) NOT NULL CHECK(decision_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,case_id,job_id,citation_id,claim_id,id),
 UNIQUE(tenant_id,case_id,job_id,citation_id,claim_id),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id,claim_id) REFERENCES document_claims(tenant_id,case_id,job_id,citation_id,id)
);
CREATE TRIGGER document_claim_decisions_append_only BEFORE UPDATE OR DELETE ON document_claim_decisions
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TABLE document_findings (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, job_id uuid NOT NULL, citation_id uuid NOT NULL, claim_id uuid NOT NULL,
 id uuid NOT NULL, decision_id uuid NOT NULL, text text NOT NULL CHECK(octet_length(text) BETWEEN 1 AND 8000),
 reviewer_user_id uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),
 UNIQUE(tenant_id,case_id,job_id,citation_id,claim_id),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id,claim_id,decision_id)
   REFERENCES document_claim_decisions(tenant_id,case_id,job_id,citation_id,claim_id,id)
);
CREATE TRIGGER document_findings_append_only BEFORE UPDATE OR DELETE ON document_findings
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON document_claims,document_claim_decisions,document_findings TO inveos_app;
