-- Append the profile to the existing allowed set, preserving parallel worker additions.
DO $$ DECLARE prior text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT prior FROM pg_constraint
 WHERE conrelid='integrity_jobs'::regclass AND conname='integrity_jobs_kind_check';
 ALTER TABLE integrity_jobs DROP CONSTRAINT integrity_jobs_kind_check;
 EXECUTE 'ALTER TABLE integrity_jobs ADD CONSTRAINT integrity_jobs_kind_check CHECK (('||prior||') OR kind=''tika_pdf_text_lab_v1'')';
END $$;
CREATE TABLE tika_derivatives (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,evidence_id uuid NOT NULL,
 source_digest char(64) NOT NULL,authority_version integer NOT NULL,kind text NOT NULL CHECK(kind='tika_pdf_text_lab_v1'),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),profile text NOT NULL CHECK(octet_length(profile) BETWEEN 1 AND 4096),
 profile_digest char(64) NOT NULL CHECK(profile_digest ~ '^[a-f0-9]{64}$'),
 raw_bytes bytea NOT NULL CHECK(octet_length(raw_bytes) BETWEEN 1 AND 1048576),raw_digest char(64) NOT NULL CHECK(raw_digest ~ '^[a-f0-9]{64}$'),
 output_bytes bytea NOT NULL CHECK(octet_length(output_bytes) BETWEEN 1 AND 1048576),output_digest char(64) NOT NULL CHECK(output_digest ~ '^[a-f0-9]{64}$'),
 runtime jsonb NOT NULL CHECK(octet_length(runtime::text)<=32768),
 processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tenant_id,case_id,job_id),
 FOREIGN KEY(tenant_id,case_id,job_id,evidence_id,source_digest,authority_version,kind) REFERENCES integrity_jobs(tenant_id,case_id,id,evidence_id,source_digest,authority_version,kind)
);
CREATE TRIGGER tika_derivatives_immutable BEFORE UPDATE OR DELETE ON tika_derivatives FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER tika_derivative_run BEFORE INSERT ON tika_derivatives FOR EACH ROW EXECUTE FUNCTION validate_text_derivative_run();
CREATE FUNCTION require_tika_derivative_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind='tika_pdf_text_lab_v1' AND NEW.status='succeeded' AND NOT EXISTS(SELECT 1 FROM tika_derivatives WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND job_id=NEW.id)
 THEN RAISE EXCEPTION 'Successful Tika job requires immutable derivative'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tika_success_result AFTER INSERT OR UPDATE ON integrity_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_tika_derivative_result();
CREATE TABLE tika_citations (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,id uuid NOT NULL,
 selection jsonb NOT NULL,record jsonb NOT NULL,digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL,request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,job_id,id),FOREIGN KEY(tenant_id,case_id,job_id) REFERENCES tika_derivatives(tenant_id,case_id,job_id)
);
CREATE TABLE tika_citation_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,citation_id uuid NOT NULL,id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 100),record jsonb NOT NULL,digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 reviewer_id uuid NOT NULL REFERENCES users(id),request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,job_id,citation_id,sequence),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id) REFERENCES tika_citations(tenant_id,case_id,job_id,id)
);
CREATE TABLE tika_claims (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,citation_id uuid NOT NULL,id uuid NOT NULL,
 record jsonb NOT NULL,digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),author_id uuid NOT NULL REFERENCES users(id),request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,job_id,citation_id,id),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id) REFERENCES tika_citations(tenant_id,case_id,job_id,id)
);
CREATE TABLE tika_claim_decisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,citation_id uuid NOT NULL,claim_id uuid NOT NULL,id uuid NOT NULL,
 record jsonb NOT NULL,digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),reviewer_id uuid NOT NULL REFERENCES users(id),request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,job_id,citation_id,claim_id),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id,claim_id) REFERENCES tika_claims(tenant_id,case_id,job_id,citation_id,id)
);
CREATE TRIGGER tika_citations_immutable BEFORE UPDATE OR DELETE ON tika_citations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER tika_reviews_immutable BEFORE UPDATE OR DELETE ON tika_citation_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER tika_claims_immutable BEFORE UPDATE OR DELETE ON tika_claims FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER tika_decisions_immutable BEFORE UPDATE OR DELETE ON tika_claim_decisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON tika_derivatives,tika_citations,tika_citation_reviews,tika_claims,tika_claim_decisions TO inveos_app;
