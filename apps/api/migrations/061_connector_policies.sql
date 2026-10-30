-- Declared source approvals are records, not an assertion of legal clearance.
CREATE TABLE connector_policy_versions (
 tenant_id uuid NOT NULL REFERENCES tenants(id),adapter_id text NOT NULL CHECK(adapter_id='companies_house_profile_v1'),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),id uuid NOT NULL,
 profile_digest char(64) NOT NULL CHECK(profile_digest ~ '^[a-f0-9]{64}$'),
 purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 10 AND 2000),
 lawful_basis text NOT NULL CHECK(length(btrim(lawful_basis)) BETWEEN 10 AND 2000),
 terms_reference text NOT NULL CHECK(length(terms_reference) BETWEEN 10 AND 2000),
 terms_sha256 char(64) NOT NULL CHECK(terms_sha256 ~ '^[a-f0-9]{64}$'),
 minimisation text NOT NULL CHECK(length(btrim(minimisation)) BETWEEN 10 AND 2000),
 retention_days integer NOT NULL CHECK(retention_days BETWEEN 1 AND 3650),
 requests_per_window integer NOT NULL CHECK(requests_per_window BETWEEN 1 AND 600),
 valid_until timestamptz NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 3000),
 proposed_by uuid NOT NULL REFERENCES users(id),proposed_by_name text NOT NULL,
 proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,adapter_id,version),UNIQUE(tenant_id,id),
 CHECK(valid_until>proposed_at AND valid_until<=proposed_at+interval '30 days')
);
CREATE TABLE connector_policy_reviews (
 tenant_id uuid NOT NULL,adapter_id text NOT NULL,version integer NOT NULL,id uuid NOT NULL,
 accepted boolean NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 3000),
 legal_approval_reference text NOT NULL CHECK(length(btrim(legal_approval_reference)) BETWEEN 10 AND 2000),
 reviewer_id uuid NOT NULL REFERENCES users(id),reviewer_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,adapter_id,version),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,adapter_id,version) REFERENCES connector_policy_versions(tenant_id,adapter_id,version)
);
CREATE TABLE connector_policy_withdrawals (
 tenant_id uuid NOT NULL,adapter_id text NOT NULL,version integer NOT NULL,id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 3000),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_hash char(64) NOT NULL,PRIMARY KEY(tenant_id,adapter_id,version),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,adapter_id,version) REFERENCES connector_policy_versions(tenant_id,adapter_id,version)
);
CREATE TRIGGER connector_policy_versions_immutable BEFORE UPDATE OR DELETE ON connector_policy_versions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER connector_policy_reviews_immutable BEFORE UPDATE OR DELETE ON connector_policy_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER connector_policy_withdrawals_immutable BEFORE UPDATE OR DELETE ON connector_policy_withdrawals FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON connector_policy_versions,connector_policy_reviews,connector_policy_withdrawals TO inveos_app;
