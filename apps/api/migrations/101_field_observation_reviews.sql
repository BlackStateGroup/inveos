CREATE TABLE field_observation_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,capture_id uuid NOT NULL,
 reviewer_id uuid NOT NULL,request_sha256 char(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,capture_id) REFERENCES field_session_records(tenant_id,case_id,capture_id),
 FOREIGN KEY(tenant_id,reviewer_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX field_observation_review_history ON field_observation_reviews(tenant_id,case_id,capture_id,recorded_at,id);
CREATE TRIGGER field_observation_reviews_immutable BEFORE UPDATE OR DELETE ON field_observation_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON field_observation_reviews TO inveos_app;
