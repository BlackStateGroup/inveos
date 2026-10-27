CREATE TABLE integrity_jobs (
  tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
  evidence_id uuid NOT NULL, source_digest char(64) NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL DEFAULT 'original_sha256_v1' CHECK (kind='original_sha256_v1'),
  authority_version integer NOT NULL, requested_by uuid NOT NULL,
  idempotency_key uuid NOT NULL, status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  lease_token uuid, lease_until timestamptz, failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  PRIMARY KEY (tenant_id,case_id,id),
  UNIQUE (tenant_id,case_id,requested_by,idempotency_key),
  FOREIGN KEY (tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id),
  FOREIGN KEY (tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
  FOREIGN KEY (tenant_id,requested_by) REFERENCES memberships(tenant_id,user_id),
  CHECK ((status='running') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE TABLE integrity_job_events (
  tenant_id uuid NOT NULL, case_id uuid NOT NULL, job_id uuid NOT NULL,
  id bigint GENERATED ALWAYS AS IDENTITY, status text NOT NULL, attempt integer NOT NULL,
  failure_code text, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,case_id,id),
  FOREIGN KEY (tenant_id,case_id,job_id) REFERENCES integrity_jobs(tenant_id,case_id,id)
);
CREATE TRIGGER integrity_job_events_append_only BEFORE UPDATE OR DELETE ON integrity_job_events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION preserve_integrity_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id,NEW.case_id,NEW.id,NEW.evidence_id,NEW.source_digest,NEW.authority_version,NEW.requested_by,NEW.idempotency_key,NEW.created_at,NEW.kind)
    IS DISTINCT FROM
    (OLD.tenant_id,OLD.case_id,OLD.id,OLD.evidence_id,OLD.source_digest,OLD.authority_version,OLD.requested_by,OLD.idempotency_key,OLD.created_at,OLD.kind)
  THEN RAISE EXCEPTION 'Job identity is immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER integrity_job_identity BEFORE UPDATE ON integrity_jobs FOR EACH ROW EXECUTE FUNCTION preserve_integrity_job_identity();
GRANT SELECT,INSERT,UPDATE ON integrity_jobs TO inveos_app;
GRANT SELECT,INSERT ON integrity_job_events TO inveos_app;
GRANT USAGE ON SEQUENCE integrity_job_events_id_seq TO inveos_app;
