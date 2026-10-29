CREATE TABLE report_disclosure_packages (
 tenant_id uuid NOT NULL,disclosure_id uuid NOT NULL,report_digest char(64) NOT NULL,
 package_digest char(64) NOT NULL,package_bytes bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,disclosure_id),
 FOREIGN KEY(tenant_id,disclosure_id) REFERENCES report_disclosures(tenant_id,id),
 CHECK(octet_length(package_bytes)>0 AND octet_length(package_bytes)<=67108864)
);
CREATE TRIGGER disclosure_package_append_only BEFORE UPDATE OR DELETE ON report_disclosure_packages FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON report_disclosure_packages TO inveos_app;
