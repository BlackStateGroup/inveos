-- Shares existing bounded staging and immutable original storage; no second custody store.
CREATE TABLE portal_evidence_uploads (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,publication_id uuid NOT NULL,response_id uuid NOT NULL,
 upload_id uuid NOT NULL,consent_declaration text NOT NULL CHECK(length(btrim(consent_declaration)) BETWEEN 10 AND 2000),
 request_hash char(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tenant_id,case_id,upload_id),
 FOREIGN KEY(tenant_id,case_id,upload_id) REFERENCES upload_reservations(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id,publication_id,response_id) REFERENCES portal_evidence_responses(tenant_id,case_id,request_id,publication_id,id)
);
CREATE TABLE portal_evidence_receipts (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,upload_id uuid NOT NULL,evidence_id uuid NOT NULL,
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 262144),
 received_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,upload_id),UNIQUE(tenant_id,case_id,evidence_id),
 FOREIGN KEY(tenant_id,case_id,upload_id) REFERENCES portal_evidence_uploads(tenant_id,case_id,upload_id),
 FOREIGN KEY(tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id)
);
CREATE TRIGGER portal_evidence_upload_immutable BEFORE UPDATE OR DELETE ON portal_evidence_uploads FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER portal_evidence_receipt_immutable BEFORE UPDATE OR DELETE ON portal_evidence_receipts FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON portal_evidence_uploads,portal_evidence_receipts TO inveos_app;
