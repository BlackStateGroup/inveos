CREATE TABLE document_citation_reviews (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, job_id uuid NOT NULL, citation_id uuid NOT NULL, id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 100),
 reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL,
 request jsonb NOT NULL, review_bytes bytea NOT NULL CHECK(octet_length(review_bytes) BETWEEN 1 AND 16384),
 review_digest char(64) NOT NULL CHECK(review_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,case_id,job_id,citation_id,id),
 UNIQUE(tenant_id,case_id,job_id,citation_id,sequence),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id) REFERENCES document_citation_candidates(tenant_id,case_id,job_id,id)
);
CREATE TRIGGER document_citation_reviews_append_only BEFORE UPDATE OR DELETE ON document_citation_reviews
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON document_citation_reviews TO inveos_app;
