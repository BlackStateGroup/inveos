-- Preserve historical v1 records; future disclosure-capable copies use v2.
ALTER TABLE report_editable_renditions DROP CONSTRAINT report_editable_renditions_profile_check;
ALTER TABLE report_editable_renditions ADD CONSTRAINT report_editable_renditions_profile_check CHECK(profile IN ('inveos_report_docx_v1','inveos_report_docx_v2'));

-- Editable DOCX copies require an independent decision on their exact stored bytes.
CREATE TABLE report_editable_rendition_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,rendition_id uuid NOT NULL,
 id uuid NOT NULL,reviewer_id uuid NOT NULL,authority_version integer NOT NULL,
 docx_digest char(64) NOT NULL,redaction_digest char(64) NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accept_for_disclosure','request_changes')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,rendition_id,reviewer_id),UNIQUE(id),
 FOREIGN KEY(tenant_id,case_id,rendition_id) REFERENCES report_editable_renditions(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,reviewer_id) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 CHECK(docx_digest ~ '^[a-f0-9]{64}$' AND redaction_digest ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER editable_rendition_review_append_only BEFORE UPDATE OR DELETE ON report_editable_rendition_reviews
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
ALTER TABLE report_editable_renditions ADD UNIQUE(tenant_id,case_id,revision_id,id);
CREATE TABLE report_disclosure_editable_renditions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,revision_id uuid NOT NULL,
 disclosure_id uuid NOT NULL,rendition_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,disclosure_id),
 FOREIGN KEY(tenant_id,case_id,revision_id,disclosure_id) REFERENCES report_disclosures(tenant_id,case_id,revision_id,id),
 FOREIGN KEY(tenant_id,case_id,revision_id,rendition_id) REFERENCES report_editable_renditions(tenant_id,case_id,revision_id,id)
);
CREATE INDEX editable_rendition_review_policy_idx ON report_editable_rendition_reviews(tenant_id,case_id,rendition_id,decision);
CREATE TRIGGER disclosure_editable_rendition_append_only BEFORE UPDATE OR DELETE ON report_disclosure_editable_renditions
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON report_editable_rendition_reviews,report_disclosure_editable_renditions TO inveos_app;

-- Serialise attachment selection without granting mutation of the immutable grant.
-- This also protects a direct application-role insert racing another format.
CREATE FUNCTION guard_single_disclosure_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.disclosure_id::text, 57));
 IF (TG_TABLE_NAME <> 'report_disclosure_packages' AND EXISTS(SELECT 1 FROM report_disclosure_packages WHERE tenant_id=NEW.tenant_id AND disclosure_id=NEW.disclosure_id))
 OR (TG_TABLE_NAME <> 'report_disclosure_renditions' AND EXISTS(SELECT 1 FROM report_disclosure_renditions WHERE tenant_id=NEW.tenant_id AND disclosure_id=NEW.disclosure_id))
 OR (TG_TABLE_NAME <> 'report_disclosure_editable_renditions' AND EXISTS(SELECT 1 FROM report_disclosure_editable_renditions WHERE tenant_id=NEW.tenant_id AND disclosure_id=NEW.disclosure_id))
 THEN RAISE EXCEPTION 'Disclosure already has a different deliverable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER disclosure_package_single_attachment BEFORE INSERT ON report_disclosure_packages FOR EACH ROW EXECUTE FUNCTION guard_single_disclosure_attachment();
CREATE TRIGGER disclosure_pdf_single_attachment BEFORE INSERT ON report_disclosure_renditions FOR EACH ROW EXECUTE FUNCTION guard_single_disclosure_attachment();
CREATE TRIGGER disclosure_docx_single_attachment BEFORE INSERT ON report_disclosure_editable_renditions FOR EACH ROW EXECUTE FUNCTION guard_single_disclosure_attachment();
