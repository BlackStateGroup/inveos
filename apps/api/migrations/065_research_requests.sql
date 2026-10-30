-- Preserve existing company policy rows and their serialized verifier contract.
ALTER TABLE connector_policy_versions DROP CONSTRAINT connector_policy_versions_adapter_id_check;
ALTER TABLE connector_policy_versions ADD CONSTRAINT connector_policy_versions_adapter_id_check CHECK(adapter_id IN('companies_house_profile_v1','rdap_domain_v1','supplied_webpage_v1'));
CREATE TABLE connector_policy_scopes (
 tenant_id uuid NOT NULL,adapter_id text NOT NULL,version integer NOT NULL,
 endpoint_scope text NOT NULL CHECK(length(endpoint_scope) BETWEEN 10 AND 2000),
 credential_scope text NOT NULL CHECK(credential_scope='none:controlled-input'),
 PRIMARY KEY(tenant_id,adapter_id,version),
 FOREIGN KEY(tenant_id,adapter_id,version) REFERENCES connector_policy_versions(tenant_id,adapter_id,version),
 CHECK(adapter_id IN('rdap_domain_v1','supplied_webpage_v1'))
);
CREATE TRIGGER connector_policy_scopes_immutable BEFORE UPDATE OR DELETE ON connector_policy_scopes FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON connector_policy_scopes TO inveos_app;
CREATE TABLE research_requests (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 PRIMARY KEY(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TABLE research_request_versions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),id uuid NOT NULL,
 adapter_id text NOT NULL CHECK(adapter_id IN('rdap_domain_v1','supplied_webpage_v1')),policy_version integer NOT NULL,
 authority_id uuid NOT NULL,authority_version integer NOT NULL,author_id uuid NOT NULL REFERENCES users(id),
 snapshot jsonb NOT NULL,digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),request_hash char(64) NOT NULL,
 recorded_at timestamptz NOT NULL,valid_until timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,request_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id) REFERENCES research_requests(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,adapter_id,policy_version) REFERENCES connector_policy_scopes(tenant_id,adapter_id,version),
 FOREIGN KEY(tenant_id,case_id,authority_id,authority_version) REFERENCES authority_records(tenant_id,case_id,id,version),
 CHECK(valid_until>recorded_at AND valid_until<=recorded_at+interval '24 hours')
);
ALTER TABLE research_requests ADD CONSTRAINT research_current_version FOREIGN KEY(tenant_id,case_id,id,version) REFERENCES research_request_versions(tenant_id,case_id,request_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION guard_research_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Research requests retain consecutive versions'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER research_request_guard BEFORE UPDATE OR DELETE ON research_requests FOR EACH ROW EXECUTE FUNCTION guard_research_request();
CREATE TABLE research_request_withdrawals (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,request_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,request_id),FOREIGN KEY(tenant_id,case_id,request_id) REFERENCES research_requests(tenant_id,case_id,id)
);
CREATE TRIGGER research_versions_immutable BEFORE UPDATE OR DELETE ON research_request_versions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER research_withdrawals_immutable BEFORE UPDATE OR DELETE ON research_request_withdrawals FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT,UPDATE ON research_requests TO inveos_app;
GRANT SELECT,INSERT ON research_request_versions,research_request_withdrawals TO inveos_app;
CREATE TABLE research_runs (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,request_id uuid NOT NULL,request_version integer NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),previous_run_id uuid,
 execution_mode text NOT NULL CHECK(execution_mode IN('supplied','rdap_transport')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','succeeded','failed','cancelled')),
 lease_token uuid,lease_until timestamptz,failure_code text,finished_at timestamptz,
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,request_id,request_version) REFERENCES research_request_versions(tenant_id,case_id,request_id,version),
 FOREIGN KEY(tenant_id,case_id,previous_run_id) REFERENCES research_runs(tenant_id,case_id,id),
 CHECK((status='running')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((status IN('succeeded','failed','cancelled'))=(finished_at IS NOT NULL))
);
CREATE TABLE research_run_events (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,run_id uuid NOT NULL,id bigint GENERATED ALWAYS AS IDENTITY,
 status text NOT NULL,detail text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,run_id,id),FOREIGN KEY(tenant_id,case_id,run_id) REFERENCES research_runs(tenant_id,case_id,id)
);
CREATE TRIGGER research_run_guard BEFORE INSERT OR UPDATE OR DELETE ON research_runs FOR EACH ROW EXECUTE FUNCTION guard_collection_job();
CREATE FUNCTION log_research_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO research_run_events(tenant_id,case_id,run_id,status,detail) VALUES(NEW.tenant_id,NEW.case_id,NEW.id,NEW.status,coalesce(NEW.failure_code,NEW.status));
 RETURN NEW;
END $$;
CREATE TRIGGER research_run_log AFTER INSERT OR UPDATE ON research_runs FOR EACH ROW EXECUTE FUNCTION log_research_run();
CREATE TRIGGER research_events_immutable BEFORE UPDATE OR DELETE ON research_run_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TABLE research_captures (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,run_id uuid NOT NULL,evidence_id uuid NOT NULL,source_id uuid NOT NULL,
 receipt jsonb NOT NULL,digest char(64) NOT NULL,input_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,run_id),UNIQUE(tenant_id,case_id,evidence_id),
 FOREIGN KEY(tenant_id,case_id,run_id) REFERENCES research_runs(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,source_id) REFERENCES manual_sources(tenant_id,case_id,id)
);
CREATE FUNCTION require_research_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='succeeded' AND NOT EXISTS(SELECT 1 FROM research_captures WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND run_id=NEW.id) THEN RAISE EXCEPTION 'Successful research run requires its immutable capture'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER research_success_capture AFTER INSERT OR UPDATE ON research_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_research_capture();
CREATE TRIGGER research_captures_immutable BEFORE UPDATE OR DELETE ON research_captures FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT,UPDATE ON research_runs TO inveos_app;
GRANT SELECT,INSERT ON research_run_events,research_captures TO inveos_app;
GRANT USAGE,SELECT ON SEQUENCE research_run_events_id_seq TO inveos_app;
CREATE INDEX research_request_history ON research_request_versions(tenant_id,case_id,request_id,version DESC);
CREATE INDEX research_run_history ON research_runs(tenant_id,case_id,requested_at DESC,id DESC);
