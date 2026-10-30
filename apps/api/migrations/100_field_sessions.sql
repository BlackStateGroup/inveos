-- Organisational projections only. Original bytes remain in evidence/field_captures.
CREATE TABLE field_sessions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,user_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,id,user_id),
 FOREIGN KEY(tenant_id,case_id,id) REFERENCES field_captures(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE field_session_records (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,capture_id uuid NOT NULL,
 session_id uuid NOT NULL,user_id uuid NOT NULL,observation_id uuid,
 kind text NOT NULL CHECK(kind IN ('session_start','session_end','session_amend','observation_record','observation_correct')),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),previous_capture_id uuid,
 request_id uuid NOT NULL,request_sha256 char(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,capture_id),UNIQUE(tenant_id,case_id,request_id),
 FOREIGN KEY(tenant_id,case_id,session_id,user_id) REFERENCES field_sessions(tenant_id,case_id,id,user_id),
 FOREIGN KEY(tenant_id,case_id,capture_id) REFERENCES field_captures(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,previous_capture_id) REFERENCES field_session_records(tenant_id,case_id,capture_id),
 CHECK((observation_id IS NULL)=(kind IN ('session_start','session_end','session_amend')))
);
CREATE UNIQUE INDEX field_session_version ON field_session_records(tenant_id,case_id,session_id,version) WHERE observation_id IS NULL;
CREATE UNIQUE INDEX field_observation_version ON field_session_records(tenant_id,case_id,observation_id,version) WHERE observation_id IS NOT NULL;
CREATE UNIQUE INDEX field_session_single_end ON field_session_records(tenant_id,case_id,session_id) WHERE kind='session_end';
CREATE INDEX field_session_record_history ON field_session_records(tenant_id,case_id,session_id,observation_id,version);
CREATE TRIGGER field_sessions_immutable BEFORE UPDATE OR DELETE ON field_sessions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER field_session_records_immutable BEFORE UPDATE OR DELETE ON field_session_records FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON field_sessions,field_session_records TO inveos_app;
