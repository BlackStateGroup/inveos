CREATE TABLE attention_preferences (
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 request_id uuid NOT NULL,expected_version integer NOT NULL CHECK(expected_version>=0),
 deadlines boolean NOT NULL,failures boolean NOT NULL,reviews boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,user_id,version),UNIQUE(tenant_id,user_id,request_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id),CHECK(version=expected_version+1)
);
CREATE TABLE attention_acknowledgements (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,user_id uuid NOT NULL,
 item_key text NOT NULL CHECK(length(item_key) BETWEEN 1 AND 200),revision text NOT NULL CHECK(length(revision) BETWEEN 1 AND 100),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,user_id,item_key,revision),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER attention_preferences_immutable BEFORE UPDATE OR DELETE ON attention_preferences FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER attention_acknowledgements_immutable BEFORE UPDATE OR DELETE ON attention_acknowledgements FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE INDEX attention_failed_jobs ON integrity_jobs(tenant_id,requested_by,case_id,id) WHERE status='failed';
CREATE INDEX attention_expired_uploads ON upload_reservations(tenant_id,created_by,expires_at,case_id,id) WHERE status='open';
GRANT SELECT,INSERT ON attention_preferences,attention_acknowledgements TO inveos_app;
