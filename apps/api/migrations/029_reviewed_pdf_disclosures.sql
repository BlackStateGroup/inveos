-- A PDF is reviewed and released by its exact immutable rendition identity.
CREATE TABLE report_rendition_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,rendition_id uuid NOT NULL,
 id uuid NOT NULL,reviewer_id uuid NOT NULL,authority_version integer NOT NULL,
 pdf_digest char(64) NOT NULL,redaction_digest char(64) NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accept_for_disclosure','request_changes')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,rendition_id,reviewer_id),UNIQUE(id),
 FOREIGN KEY(tenant_id,case_id,rendition_id) REFERENCES report_renditions(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,reviewer_id) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 CHECK(pdf_digest ~ '^[a-f0-9]{64}$' AND redaction_digest ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER rendition_review_append_only BEFORE UPDATE OR DELETE ON report_rendition_reviews
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
ALTER TABLE report_disclosures ADD UNIQUE(tenant_id,case_id,revision_id,id);
ALTER TABLE report_renditions ADD UNIQUE(tenant_id,case_id,revision_id,id);
CREATE TABLE report_disclosure_renditions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,revision_id uuid NOT NULL,
 disclosure_id uuid NOT NULL,rendition_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,disclosure_id),
 FOREIGN KEY(tenant_id,case_id,revision_id,disclosure_id) REFERENCES report_disclosures(tenant_id,case_id,revision_id,id),
 FOREIGN KEY(tenant_id,case_id,revision_id,rendition_id) REFERENCES report_renditions(tenant_id,case_id,revision_id,id)
);
CREATE INDEX rendition_review_policy_idx ON report_rendition_reviews(tenant_id,case_id,rendition_id,decision);
CREATE TRIGGER disclosure_rendition_append_only BEFORE UPDATE OR DELETE ON report_disclosure_renditions
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON report_rendition_reviews,report_disclosure_renditions TO inveos_app;
