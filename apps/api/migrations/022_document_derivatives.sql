ALTER TABLE integrity_jobs DROP CONSTRAINT integrity_jobs_kind_check;
ALTER TABLE integrity_jobs ADD CONSTRAINT integrity_jobs_kind_check CHECK (kind IN ('original_sha256_v1','utf8_line_index_v1','native_pdf_lab_v1'));
CREATE TABLE document_derivatives (
  tenant_id uuid NOT NULL, case_id uuid NOT NULL, job_id uuid NOT NULL,
  evidence_id uuid NOT NULL, source_digest char(64) NOT NULL,
  authority_version integer NOT NULL, kind text NOT NULL CHECK (kind='native_pdf_lab_v1'),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  profile text NOT NULL CHECK (octet_length(profile) BETWEEN 1 AND 4096),
  profile_digest char(64) NOT NULL CHECK (profile_digest ~ '^[a-f0-9]{64}$'),
  raw_bytes bytea NOT NULL CHECK (octet_length(raw_bytes) BETWEEN 1 AND 1048576),
  raw_digest char(64) NOT NULL CHECK (raw_digest ~ '^[a-f0-9]{64}$'),
  output_bytes bytea NOT NULL CHECK (octet_length(output_bytes) BETWEEN 1 AND 1048576),
  output_digest char(64) NOT NULL CHECK (output_digest ~ '^[a-f0-9]{64}$'),
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,case_id,job_id),
  FOREIGN KEY (tenant_id,case_id,job_id,evidence_id,source_digest,authority_version,kind)
    REFERENCES integrity_jobs(tenant_id,case_id,id,evidence_id,source_digest,authority_version,kind)
);
CREATE TRIGGER document_derivatives_append_only BEFORE UPDATE OR DELETE ON document_derivatives
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER document_derivative_run BEFORE INSERT ON document_derivatives
  FOR EACH ROW EXECUTE FUNCTION validate_text_derivative_run();
CREATE FUNCTION require_document_derivative_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM integrity_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.case_id=NEW.case_id
    AND j.id=NEW.id AND j.kind='native_pdf_lab_v1' AND j.status='succeeded') AND NOT EXISTS (
      SELECT 1 FROM document_derivatives d WHERE d.tenant_id=NEW.tenant_id AND d.case_id=NEW.case_id AND d.job_id=NEW.id)
  THEN RAISE EXCEPTION 'Successful document job requires immutable derivative' USING ERRCODE='55000'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER document_job_atomic_result AFTER INSERT OR UPDATE ON integrity_jobs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_document_derivative_result();
GRANT SELECT,INSERT ON document_derivatives TO inveos_app;
