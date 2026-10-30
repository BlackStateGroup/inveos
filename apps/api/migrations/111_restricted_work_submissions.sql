CREATE TABLE restricted_work_submissions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,grant_id uuid NOT NULL,id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 200),
 publication_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('progress','submitted','withdrawn')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 10 AND 8000),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 sha256 char(64) NOT NULL,request_hash char(64) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,grant_id,sequence),UNIQUE(tenant_id,case_id,grant_id,id),
 FOREIGN KEY(tenant_id,case_id,grant_id,publication_id) REFERENCES restricted_work_publications(tenant_id,case_id,grant_id,id)
);
CREATE TABLE restricted_work_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,grant_id uuid NOT NULL,id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 200),
 submission_id uuid NOT NULL,submission_sha256 char(64) NOT NULL,task_id uuid NOT NULL,task_version integer NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accepted','changes_requested')),feedback text NOT NULL CHECK(length(btrim(feedback)) BETWEEN 10 AND 2000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),request_hash char(64) NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,grant_id,sequence),
 FOREIGN KEY(tenant_id,case_id,grant_id,submission_id) REFERENCES restricted_work_submissions(tenant_id,case_id,grant_id,id),
 FOREIGN KEY(tenant_id,case_id,task_id,task_version) REFERENCES case_work_revisions(tenant_id,case_id,item_id,version)
);
CREATE TRIGGER restricted_work_submission_immutable BEFORE UPDATE OR DELETE ON restricted_work_submissions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER restricted_work_review_immutable BEFORE UPDATE OR DELETE ON restricted_work_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON restricted_work_submissions,restricted_work_reviews TO inveos_app;
