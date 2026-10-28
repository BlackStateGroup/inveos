CREATE TABLE report_disclosure_acknowledgements (
 tenant_id uuid NOT NULL,disclosure_id uuid NOT NULL,recipient_id uuid NOT NULL,digest char(64) NOT NULL,
 acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,disclosure_id),
 FOREIGN KEY(tenant_id,disclosure_id) REFERENCES report_disclosures(tenant_id,id),
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER disclosure_acknowledgement_append_only BEFORE UPDATE OR DELETE ON report_disclosure_acknowledgements FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON report_disclosure_acknowledgements TO inveos_app;
