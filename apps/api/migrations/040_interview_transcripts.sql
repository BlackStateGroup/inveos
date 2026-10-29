CREATE TABLE interview_transcripts (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL, evidence_id uuid NOT NULL,
 evidence_digest char(64) NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'), authority_version integer NOT NULL CHECK(authority_version>0),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 240), request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id), UNIQUE(tenant_id,case_id,evidence_id), FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id), FOREIGN KEY(tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id), FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version)
);
CREATE TABLE interview_transcript_segments (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, transcript_id uuid NOT NULL, id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 99),
 start_ms integer NOT NULL CHECK(start_ms>=0), end_ms integer NOT NULL CHECK(end_ms>start_ms AND end_ms<=86400000), speaker_label text NOT NULL CHECK(length(btrim(speaker_label)) BETWEEN 1 AND 120), speaker_uncertain boolean NOT NULL, raw_text text NOT NULL CHECK(length(btrim(raw_text)) BETWEEN 1 AND 10000), current_version integer NOT NULL DEFAULT 0 CHECK(current_version BETWEEN 0 AND 100),
 PRIMARY KEY(tenant_id,case_id,transcript_id,id), UNIQUE(tenant_id,case_id,transcript_id,ordinal), FOREIGN KEY(tenant_id,case_id,transcript_id) REFERENCES interview_transcripts(tenant_id,case_id,id)
);
CREATE TABLE interview_transcript_corrections (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, transcript_id uuid NOT NULL, segment_id uuid NOT NULL, id uuid NOT NULL, request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), start_ms integer NOT NULL CHECK(start_ms>=0), end_ms integer NOT NULL CHECK(end_ms>start_ms AND end_ms<=86400000), version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 speaker_label text NOT NULL CHECK(length(btrim(speaker_label)) BETWEEN 1 AND 120), speaker_uncertain boolean NOT NULL, text text NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 10000), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 3000),
 actor_id uuid NOT NULL REFERENCES users(id), actor_name text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,transcript_id,segment_id,version), UNIQUE(tenant_id,case_id,transcript_id,segment_id,id), FOREIGN KEY(tenant_id,case_id,transcript_id,segment_id) REFERENCES interview_transcript_segments(tenant_id,case_id,transcript_id,id)
);
CREATE TRIGGER interview_transcript_immutable BEFORE UPDATE OR DELETE ON interview_transcripts FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER interview_segment_no_delete BEFORE DELETE ON interview_transcript_segments FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER interview_segment_raw_immutable BEFORE UPDATE ON interview_transcript_segments FOR EACH ROW WHEN (OLD.raw_text IS DISTINCT FROM NEW.raw_text OR OLD.speaker_label IS DISTINCT FROM NEW.speaker_label OR OLD.speaker_uncertain IS DISTINCT FROM NEW.speaker_uncertain OR OLD.start_ms IS DISTINCT FROM NEW.start_ms OR OLD.end_ms IS DISTINCT FROM NEW.end_ms OR OLD.ordinal IS DISTINCT FROM NEW.ordinal) EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER interview_correction_immutable BEFORE UPDATE OR DELETE ON interview_transcript_corrections FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON interview_transcripts,interview_transcript_segments,interview_transcript_corrections TO inveos_app;
GRANT UPDATE(current_version) ON interview_transcript_segments TO inveos_app;

CREATE FUNCTION preserve_transcript_segment_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'current_version') IS DISTINCT FROM (to_jsonb(OLD)-'current_version') THEN
  RAISE EXCEPTION 'Raw transcript segment is immutable' USING ERRCODE='55000';
 END IF;
 IF NEW.current_version<>OLD.current_version+1 OR NOT EXISTS(SELECT 1 FROM interview_transcript_corrections c WHERE c.tenant_id=NEW.tenant_id AND c.case_id=NEW.case_id AND c.transcript_id=NEW.transcript_id AND c.segment_id=NEW.id AND c.version=NEW.current_version) THEN
  RAISE EXCEPTION 'Transcript head requires the next immutable correction' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER transcript_segment_head BEFORE UPDATE ON interview_transcript_segments FOR EACH ROW EXECUTE FUNCTION preserve_transcript_segment_head();
