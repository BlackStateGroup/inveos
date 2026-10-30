CREATE TABLE processing_batches (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,requested_by uuid NOT NULL,
 kind text NOT NULL,profile_digest char(64) NOT NULL CHECK(profile_digest ~ '^[a-f0-9]{64}$'),
 authority_version integer NOT NULL,request_sha256 char(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 request jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),parent_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 FOREIGN KEY(tenant_id,requested_by) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,case_id,parent_id) REFERENCES processing_batches(tenant_id,case_id,id)
);
CREATE TABLE processing_batch_items (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,batch_id uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 25),
 evidence_id uuid NOT NULL,expected_digest char(64) NOT NULL CHECK(expected_digest ~ '^[a-f0-9]{64}$'),retry_of uuid,
 outcome text NOT NULL CHECK(outcome IN('queued','rejected')),code text,message text NOT NULL,
 job_id uuid,job_receipt jsonb,
 PRIMARY KEY(tenant_id,case_id,batch_id,ordinal),UNIQUE(tenant_id,case_id,batch_id,evidence_id),
 FOREIGN KEY(tenant_id,case_id,batch_id) REFERENCES processing_batches(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id) REFERENCES integrity_jobs(tenant_id,case_id,id),
 CHECK((outcome='queued' AND job_id IS NOT NULL AND job_receipt IS NOT NULL AND code IS NULL) OR
       (outcome='rejected' AND job_id IS NULL AND job_receipt IS NULL AND code IS NOT NULL))
 -- Rejected foreign/unavailable evidence and retry UUIDs are retained only as submitted assertions, never joined unscoped.
);
CREATE TABLE processing_batch_cancellations (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,batch_id uuid NOT NULL,id uuid NOT NULL,requested_by uuid NOT NULL,
 request_sha256 char(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 results jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,batch_id) REFERENCES processing_batches(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,requested_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX processing_batches_case_history ON processing_batches(tenant_id,case_id,created_at DESC,id DESC);
CREATE INDEX processing_batch_job ON processing_batch_items(tenant_id,case_id,job_id);
CREATE TRIGGER processing_batches_immutable BEFORE UPDATE OR DELETE ON processing_batches FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER processing_batch_items_immutable BEFORE UPDATE OR DELETE ON processing_batch_items FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER processing_batch_cancellations_immutable BEFORE UPDATE OR DELETE ON processing_batch_cancellations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON processing_batches,processing_batch_items,processing_batch_cancellations TO inveos_app;
CREATE FUNCTION validate_processing_batch_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch processing_batches; selected jsonb;
BEGIN
 SELECT * INTO batch FROM processing_batches b WHERE b.tenant_id=NEW.tenant_id AND b.case_id=NEW.case_id AND b.id=NEW.batch_id;
 selected := batch.request->'items'->(NEW.ordinal-1);
 IF selected IS NULL OR selected->>'evidenceId' IS DISTINCT FROM NEW.evidence_id::text OR
    selected->>'expectedDigest' IS DISTINCT FROM btrim(NEW.expected_digest) OR
    selected->>'retryOf' IS DISTINCT FROM NEW.retry_of::text THEN
  RAISE EXCEPTION 'Batch item differs from immutable selection';
 END IF;
 IF NEW.outcome='queued' AND NOT EXISTS(SELECT 1 FROM integrity_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.case_id=NEW.case_id AND j.id=NEW.job_id
   AND j.evidence_id=NEW.evidence_id AND j.source_digest=NEW.expected_digest AND j.kind=batch.kind
   AND j.authority_version=batch.authority_version AND j.requested_by=batch.requested_by
   AND NEW.job_receipt->>'id'=j.id::text) THEN RAISE EXCEPTION 'Batch job lineage differs'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER processing_batch_item_lineage BEFORE INSERT ON processing_batch_items FOR EACH ROW EXECUTE FUNCTION validate_processing_batch_item();
CREATE FUNCTION complete_processing_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF jsonb_array_length(NEW.request->'items') NOT BETWEEN 1 AND 25 OR
    (SELECT count(*) FROM processing_batch_items i WHERE i.tenant_id=NEW.tenant_id AND i.case_id=NEW.case_id AND i.batch_id=NEW.id) <> jsonb_array_length(NEW.request->'items') THEN
  RAISE EXCEPTION 'Every selected original requires a retained batch outcome';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER processing_batch_complete AFTER INSERT ON processing_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_processing_batch();
