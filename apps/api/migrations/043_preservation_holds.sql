CREATE TABLE preservation_holds (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,evidence_id uuid,
 evidence_digest char(64),evidence_filename text,source_authority_version integer,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,evidence_id) REFERENCES evidence(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,source_authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 CHECK((evidence_id IS NULL AND evidence_digest IS NULL AND evidence_filename IS NULL AND source_authority_version IS NULL) OR
       (evidence_id IS NOT NULL AND evidence_digest IS NOT NULL AND evidence_digest ~ '^[a-f0-9]{64}$' AND evidence_filename IS NOT NULL AND source_authority_version IS NOT NULL))
);
CREATE TABLE preservation_hold_revisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,hold_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action IN ('declared','amended','released')),status text NOT NULL CHECK(status IN ('active','released')),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 3 AND 200),authority_reference text NOT NULL CHECK(length(btrim(authority_reference)) BETWEEN 3 AND 2000),
 purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 10 AND 2000),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,hold_id,version),UNIQUE(tenant_id,case_id,hold_id,id),
 FOREIGN KEY(tenant_id,case_id,hold_id) REFERENCES preservation_holds(tenant_id,case_id,id),
 CHECK((action='released')=(status='released')),CHECK((action='declared')=(version=1))
);
ALTER TABLE preservation_holds ADD CONSTRAINT preservation_hold_head_fk FOREIGN KEY(tenant_id,case_id,id,version)
 REFERENCES preservation_hold_revisions(tenant_id,case_id,hold_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER preservation_hold_revisions_immutable BEFORE UPDATE OR DELETE ON preservation_hold_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER preservation_hold_no_delete BEFORE DELETE ON preservation_holds FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION preserve_hold_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 OR
    EXISTS(SELECT 1 FROM preservation_hold_revisions r WHERE r.tenant_id=OLD.tenant_id AND r.case_id=OLD.case_id AND r.hold_id=OLD.id AND r.version=OLD.version AND r.status='released') THEN
  RAISE EXCEPTION 'Hold identity is immutable and released holds are terminal' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preservation_hold_head BEFORE UPDATE ON preservation_holds FOR EACH ROW EXECUTE FUNCTION preserve_hold_head();
CREATE INDEX preservation_hold_target ON preservation_holds(tenant_id,case_id,evidence_id);
GRANT SELECT,INSERT ON preservation_holds,preservation_hold_revisions TO inveos_app;
GRANT UPDATE(version) ON preservation_holds TO inveos_app;
