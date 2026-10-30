-- Collection is a separate workflow: it has no original until a bounded response is committed.
CREATE TABLE collection_authorisations (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,adapter_id text NOT NULL,policy_version integer NOT NULL,
 authority_id uuid NOT NULL,authority_version integer NOT NULL,company_number text NOT NULL CHECK(company_number ~ '^[A-Z0-9]{8}$'),
 purpose text NOT NULL,minimisation text NOT NULL,retention_days integer NOT NULL CHECK(retention_days BETWEEN 1 AND 3650),
 valid_until timestamptz NOT NULL,author_id uuid NOT NULL REFERENCES users(id),author_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_hash char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,adapter_id,policy_version) REFERENCES connector_policy_versions(tenant_id,adapter_id,version),
 FOREIGN KEY(tenant_id,case_id,authority_id,authority_version) REFERENCES authority_records(tenant_id,case_id,id,version),
 CHECK(valid_until>recorded_at AND valid_until<=recorded_at+interval '24 hours')
);
CREATE TABLE collection_authorisation_withdrawals (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,authorisation_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,authorisation_id),
 FOREIGN KEY(tenant_id,case_id,authorisation_id) REFERENCES collection_authorisations(tenant_id,case_id,id)
);
CREATE TABLE collection_jobs (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,authorisation_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','succeeded','failed','cancelled')),
 lease_token uuid,lease_until timestamptz,failure_code text,finished_at timestamptz,
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,authorisation_id) REFERENCES collection_authorisations(tenant_id,case_id,id),
 CHECK((status='running')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((status IN('succeeded','failed','cancelled'))=(finished_at IS NOT NULL))
);
CREATE TABLE collection_job_events (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,id bigint GENERATED ALWAYS AS IDENTITY,
 status text NOT NULL,detail text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,job_id,id),FOREIGN KEY(tenant_id,case_id,job_id) REFERENCES collection_jobs(tenant_id,case_id,id)
);
CREATE FUNCTION guard_collection_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Collection job history is retained'; END IF;
 IF NEW.status<>'queued' AND TG_OP='INSERT' THEN RAISE EXCEPTION 'A collection job starts queued'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','lease_token','lease_until','failure_code','finished_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','lease_token','lease_until','failure_code','finished_at']) OR
     NOT ((OLD.status='queued' AND NEW.status IN('running','failed','cancelled')) OR
          (OLD.status='running' AND NEW.status IN('succeeded','failed','cancelled'))) THEN
   RAISE EXCEPTION 'Invalid collection job transition';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION log_collection_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO collection_job_events(tenant_id,case_id,job_id,status,detail) VALUES(NEW.tenant_id,NEW.case_id,NEW.id,NEW.status,coalesce(NEW.failure_code,NEW.status));
 RETURN NEW;
END $$;
CREATE TRIGGER collection_job_guard BEFORE INSERT OR UPDATE OR DELETE ON collection_jobs FOR EACH ROW EXECUTE FUNCTION guard_collection_job();
CREATE TRIGGER collection_job_log AFTER INSERT OR UPDATE ON collection_jobs FOR EACH ROW EXECUTE FUNCTION log_collection_job();
-- Credential scope is an HMAC-free SHA256 fingerprint of a random provider key, never the secret.
-- Reservations survive failure/restart and are shared across tenants using the same credential.
CREATE TABLE collection_rate_reservations (
 credential_scope char(64) NOT NULL,adapter_id text NOT NULL,id uuid PRIMARY KEY,
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX collection_rate_window ON collection_rate_reservations(credential_scope,adapter_id,reserved_at);
CREATE TABLE collection_captures (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,evidence_id uuid NOT NULL,source_id uuid NOT NULL,
 receipt jsonb NOT NULL,digest char(64) NOT NULL,
 PRIMARY KEY(tenant_id,case_id,job_id),UNIQUE(tenant_id,case_id,evidence_id),
 FOREIGN KEY(tenant_id,case_id,job_id) REFERENCES collection_jobs(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,source_id) REFERENCES manual_sources(tenant_id,case_id,id)
);
CREATE FUNCTION require_collection_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='succeeded' AND NOT EXISTS(SELECT 1 FROM collection_captures WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND job_id=NEW.id) THEN RAISE EXCEPTION 'Successful collection requires its immutable capture'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER collection_success_capture AFTER INSERT OR UPDATE ON collection_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_collection_capture();
CREATE TRIGGER collection_authorisations_immutable BEFORE UPDATE OR DELETE ON collection_authorisations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER collection_withdrawals_immutable BEFORE UPDATE OR DELETE ON collection_authorisation_withdrawals FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER collection_events_immutable BEFORE UPDATE OR DELETE ON collection_job_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER collection_rates_immutable BEFORE UPDATE OR DELETE ON collection_rate_reservations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER collection_captures_immutable BEFORE UPDATE OR DELETE ON collection_captures FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON collection_authorisations,collection_authorisation_withdrawals,collection_job_events,collection_rate_reservations,collection_captures TO inveos_app;
GRANT SELECT,INSERT,UPDATE ON collection_jobs TO inveos_app;
GRANT USAGE,SELECT ON SEQUENCE collection_job_events_id_seq TO inveos_app;
CREATE TABLE collection_provider_backoffs (
 credential_scope char(64) NOT NULL,adapter_id text NOT NULL,id uuid PRIMARY KEY,
 blocked_until timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(blocked_until>recorded_at AND blocked_until<=recorded_at+interval '24 hours')
);
CREATE INDEX collection_provider_backoff_scope ON collection_provider_backoffs(credential_scope,adapter_id,blocked_until);
CREATE TRIGGER collection_backoffs_immutable BEFORE UPDATE OR DELETE ON collection_provider_backoffs FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON collection_provider_backoffs TO inveos_app;
