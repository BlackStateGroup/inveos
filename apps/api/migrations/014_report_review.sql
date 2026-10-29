CREATE TABLE report_revision_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,revision_id uuid NOT NULL,
 id uuid NOT NULL,reviewer_id uuid NOT NULL,authority_version integer NOT NULL,
 digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision IN ('accept_internal','request_changes')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,revision_id,reviewer_id),UNIQUE(id),
 FOREIGN KEY(tenant_id,case_id,revision_id) REFERENCES report_revisions(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,reviewer_id) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version)
);
CREATE TRIGGER report_review_append_only BEFORE UPDATE OR DELETE ON report_revision_reviews
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON report_revision_reviews TO inveos_app;
