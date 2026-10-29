CREATE TABLE case_time_entries (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 created_by uuid NOT NULL REFERENCES users(id),created_by_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TABLE case_time_entry_revisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,entry_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action IN ('recorded','corrected','withdrawn')),status text NOT NULL CHECK(status IN ('active','withdrawn')),
 started_at timestamptz NOT NULL,declared_start text NOT NULL,
 minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440),description text NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 2000),billable boolean NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,entry_id,version),UNIQUE(tenant_id,case_id,entry_id,id),
 FOREIGN KEY(tenant_id,case_id,entry_id) REFERENCES case_time_entries(tenant_id,case_id,id),
 CHECK((action='recorded')=(version=1)),CHECK((action='withdrawn')=(status='withdrawn'))
);
ALTER TABLE case_time_entries ADD CONSTRAINT case_time_current_fk FOREIGN KEY(tenant_id,case_id,id,version)
 REFERENCES case_time_entry_revisions(tenant_id,case_id,entry_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX case_time_entries_recorder ON case_time_entries(tenant_id,case_id,created_by,id);
CREATE TRIGGER case_time_history_immutable BEFORE UPDATE OR DELETE ON case_time_entry_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER case_time_no_delete BEFORE DELETE ON case_time_entries FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION preserve_time_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 OR
    EXISTS(SELECT 1 FROM case_time_entry_revisions r WHERE r.tenant_id=OLD.tenant_id AND r.case_id=OLD.case_id AND r.entry_id=OLD.id AND r.version=OLD.version AND r.status='withdrawn') THEN
  RAISE EXCEPTION 'Time record identity is immutable; withdrawn entries are terminal' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_time_head BEFORE UPDATE ON case_time_entries FOR EACH ROW EXECUTE FUNCTION preserve_time_head();
GRANT SELECT,INSERT ON case_time_entries,case_time_entry_revisions TO inveos_app;
GRANT UPDATE(version) ON case_time_entries TO inveos_app;
