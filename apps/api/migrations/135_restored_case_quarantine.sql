-- Operator-only recovery decisions. Historical authority/grants/receipts remain untouched.
CREATE TABLE restored_case_quarantines (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 generation bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 actor_id uuid NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 backup_sha256 char(64) NOT NULL CHECK(backup_sha256 ~ '^[a-f0-9]{64}$'),
 quiesced boolean NOT NULL CHECK(quiesced),request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 batch_limit integer NOT NULL CHECK(batch_limit BETWEEN 1 AND 25),
 authority_version integer,handling_version integer NOT NULL,lifecycle_version integer NOT NULL,
 lifecycle_state text NOT NULL CHECK(lifecycle_state IN ('Closed','Archived')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 FOREIGN KEY(tenant_id,case_id,handling_version) REFERENCES case_handling_events(tenant_id,case_id,version),
 FOREIGN KEY(tenant_id,case_id,lifecycle_version,lifecycle_state) REFERENCES case_lifecycle_events(tenant_id,case_id,version,to_state)
);
CREATE INDEX restored_case_quarantine_head ON restored_case_quarantines(tenant_id,case_id,generation DESC);
CREATE TABLE restored_case_quarantine_batches (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,quarantine_id uuid NOT NULL,
 batch integer NOT NULL CHECK(batch BETWEEN 1 AND 10000),more_remaining boolean NOT NULL,
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,quarantine_id,batch),
 FOREIGN KEY(tenant_id,case_id,quarantine_id) REFERENCES restored_case_quarantines(tenant_id,case_id,id)
);
CREATE TRIGGER restored_case_quarantine_immutable BEFORE UPDATE OR DELETE ON restored_case_quarantines FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER restored_case_quarantine_batch_immutable BEFORE UPDATE OR DELETE ON restored_case_quarantine_batches FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION guard_restored_case_quarantine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM cases c JOIN case_handling_events h ON h.tenant_id=c.tenant_id AND h.case_id=c.id
 WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.case_id AND c.authority_version IS NOT DISTINCT FROM NEW.authority_version
 AND c.lifecycle_version=NEW.lifecycle_version AND c.lifecycle_state=NEW.lifecycle_state
 AND h.version=NEW.handling_version AND h.sharing='internal_only' AND h.actor_id=NEW.actor_id
 AND h.authority_version IS NOT DISTINCT FROM NEW.authority_version
 AND h.version=(SELECT max(version) FROM case_handling_events WHERE tenant_id=c.tenant_id AND case_id=c.id))
 OR NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id
 WHERE m.tenant_id=NEW.tenant_id AND cm.case_id=NEW.case_id AND m.user_id=NEW.actor_id AND m.role='reviewer') THEN
 RAISE EXCEPTION 'Quarantine requires current reviewer, internal handling and terminal lifecycle'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER restored_case_quarantine_guard BEFORE INSERT ON restored_case_quarantines FOR EACH ROW EXECUTE FUNCTION guard_restored_case_quarantine();
CREATE FUNCTION guard_restored_case_quarantine_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_batch integer; previous_remaining boolean;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT batch,more_remaining INTO previous_batch,previous_remaining FROM restored_case_quarantine_batches
 WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND quarantine_id=NEW.quarantine_id ORDER BY batch DESC LIMIT 1;
 IF NEW.batch<>coalesce(previous_batch,0)+1 OR previous_remaining=false OR
 NEW.receipt->>'requestId' IS DISTINCT FROM NEW.quarantine_id::text OR
 NEW.receipt->>'tenantId' IS DISTINCT FROM NEW.tenant_id::text OR NEW.receipt->>'caseId' IS DISTINCT FROM NEW.case_id::text OR
 NEW.receipt->>'batch' IS DISTINCT FROM NEW.batch::text OR NEW.receipt->>'moreRemaining' IS DISTINCT FROM NEW.more_remaining::text THEN
 RAISE EXCEPTION 'Invalid immutable quarantine continuation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER restored_case_quarantine_batch_guard BEFORE INSERT ON restored_case_quarantine_batches FOR EACH ROW EXECUTE FUNCTION guard_restored_case_quarantine_batch();
CREATE FUNCTION require_restored_case_quarantine_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM restored_case_quarantine_batches WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND quarantine_id=NEW.id AND batch=1) THEN
 RAISE EXCEPTION 'Quarantine requires its atomic initial retirement receipt'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER restored_case_quarantine_receipt AFTER INSERT ON restored_case_quarantines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_restored_case_quarantine_batch();
GRANT SELECT,INSERT ON restored_case_quarantines,restored_case_quarantine_batches TO inveos_app;
GRANT USAGE,SELECT ON SEQUENCE restored_case_quarantines_generation_seq TO inveos_app;
