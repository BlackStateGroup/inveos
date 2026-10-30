ALTER TABLE integrity_jobs DROP CONSTRAINT integrity_jobs_kind_check;
ALTER TABLE integrity_jobs ADD CONSTRAINT integrity_jobs_kind_check CHECK(kind IN
 ('original_sha256_v1','utf8_line_index_v1','native_pdf_lab_v1','pdf_raster_lab_v1','tesseract_scan_lab_v1','pdf_raster_lab_v2','tesseract_scan_lab_v2','whisper_pcm_lab_v1'));
CREATE TABLE speech_derivatives (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,
 evidence_id uuid NOT NULL,source_digest char(64) NOT NULL,authority_version integer NOT NULL,
 kind text NOT NULL CHECK(kind='whisper_pcm_lab_v1'),attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 profile text NOT NULL CHECK(octet_length(profile) BETWEEN 1 AND 4096),
 profile_digest char(64) NOT NULL CHECK(profile_digest ~ '^[a-f0-9]{64}$'),
 raw_bytes bytea NOT NULL CHECK(octet_length(raw_bytes) BETWEEN 1 AND 131072),
 raw_digest char(64) NOT NULL CHECK(raw_digest ~ '^[a-f0-9]{64}$'),
 output_bytes bytea NOT NULL CHECK(octet_length(output_bytes) BETWEEN 1 AND 524288),
 output_digest char(64) NOT NULL CHECK(output_digest ~ '^[a-f0-9]{64}$'),
 processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,job_id),
 FOREIGN KEY(tenant_id,case_id,job_id,evidence_id,source_digest,authority_version,kind)
 REFERENCES integrity_jobs(tenant_id,case_id,id,evidence_id,source_digest,authority_version,kind)
);
CREATE TRIGGER speech_derivatives_append_only BEFORE UPDATE OR DELETE ON speech_derivatives
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER speech_derivative_run BEFORE INSERT ON speech_derivatives
 FOR EACH ROW EXECUTE FUNCTION validate_text_derivative_run();
CREATE FUNCTION require_speech_derivative_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM integrity_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.case_id=NEW.case_id AND j.id=NEW.id AND j.kind='whisper_pcm_lab_v1' AND j.status='succeeded')
 AND NOT EXISTS(SELECT 1 FROM speech_derivatives d WHERE d.tenant_id=NEW.tenant_id AND d.case_id=NEW.case_id AND d.job_id=NEW.id)
 THEN RAISE EXCEPTION 'Successful speech job requires immutable derivative' USING ERRCODE='55000'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER speech_job_atomic_result AFTER INSERT OR UPDATE ON integrity_jobs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_speech_derivative_result();
GRANT SELECT,INSERT ON speech_derivatives TO inveos_app;

CREATE TABLE speech_segment_corrections (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,segment_index integer NOT NULL CHECK(segment_index BETWEEN 0 AND 127),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100),id uuid NOT NULL,
 start_ms integer NOT NULL CHECK(start_ms>=0),end_ms integer NOT NULL CHECK(end_ms>start_ms),
 has_speech boolean NOT NULL,text text NOT NULL CHECK(octet_length(text)<=16384),
 speaker_label text NOT NULL CHECK(length(speaker_label)<=120),speaker_uncertain boolean NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 3000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,request_hash char(64) NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,job_id,segment_index,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id) REFERENCES speech_derivatives(tenant_id,case_id,job_id),
 CHECK((has_speech AND length(btrim(text))>0 AND length(btrim(speaker_label))>0) OR (NOT has_speech AND text='' AND speaker_label='' AND speaker_uncertain))
);
CREATE TRIGGER speech_segment_corrections_append_only BEFORE UPDATE OR DELETE ON speech_segment_corrections
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TABLE speech_segment_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,segment_index integer NOT NULL CHECK(segment_index BETWEEN 0 AND 127),
 version integer NOT NULL CHECK(version BETWEEN 0 AND 100),id uuid NOT NULL,
 accepted boolean NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 3000),
 reviewer_id uuid NOT NULL REFERENCES users(id),reviewer_name text NOT NULL,
 snapshot jsonb NOT NULL,digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),request_hash char(64) NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,job_id,segment_index,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id) REFERENCES speech_derivatives(tenant_id,case_id,job_id)
);
CREATE TRIGGER speech_segment_reviews_append_only BEFORE UPDATE OR DELETE ON speech_segment_reviews
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON speech_segment_corrections,speech_segment_reviews TO inveos_app;
