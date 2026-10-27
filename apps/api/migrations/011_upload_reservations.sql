CREATE TABLE upload_reservations (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,created_by uuid NOT NULL,
 idempotency_key uuid NOT NULL,authority_version integer NOT NULL,metadata jsonb NOT NULL,
 byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 262144),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
 evidence_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,created_by,idempotency_key),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 FOREIGN KEY(tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id),
 CHECK((status='completed')=(evidence_id IS NOT NULL))
);
CREATE TABLE upload_chunks (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,upload_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 7),bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 32768),
 PRIMARY KEY(tenant_id,case_id,upload_id,ordinal),
 FOREIGN KEY(tenant_id,case_id,upload_id) REFERENCES upload_reservations(tenant_id,case_id,id)
);
CREATE FUNCTION preserve_upload_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.tenant_id,NEW.case_id,NEW.id,NEW.created_by,NEW.idempotency_key,NEW.authority_version,NEW.metadata,NEW.byte_length,NEW.created_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.tenant_id,OLD.case_id,OLD.id,OLD.created_by,OLD.idempotency_key,OLD.authority_version,OLD.metadata,OLD.byte_length,OLD.created_at,OLD.expires_at)
 OR OLD.status<>'open' THEN RAISE EXCEPTION 'Upload identity and terminal state are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER upload_identity BEFORE UPDATE ON upload_reservations FOR EACH ROW EXECUTE FUNCTION preserve_upload_identity();
GRANT SELECT,INSERT,UPDATE ON upload_reservations TO inveos_app;
GRANT SELECT,INSERT,DELETE ON upload_chunks TO inveos_app;
