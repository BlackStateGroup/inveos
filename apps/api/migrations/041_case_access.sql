ALTER TABLE cases ADD COLUMN access_version integer NOT NULL DEFAULT 1 CHECK(access_version BETWEEN 1 AND 1000);
CREATE TABLE case_access_events (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 action text NOT NULL CHECK(action IN ('legacy_checkpoint','case_created','member_added','member_removed','owner_transferred')),
 owner_id uuid NOT NULL REFERENCES users(id),subject_id uuid REFERENCES users(id),subject_name text,
 actor_id uuid REFERENCES users(id),actor_name text,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),request_hash char(64),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,version),UNIQUE(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,version,owner_id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 CHECK((action='legacy_checkpoint' AND actor_id IS NULL) OR (action<>'legacy_checkpoint' AND actor_id IS NOT NULL)),
 CHECK((action IN ('member_added','member_removed','owner_transferred') AND subject_id IS NOT NULL AND request_hash IS NOT NULL AND request_hash ~ '^[0-9a-f]{64}$') OR (action IN ('legacy_checkpoint','case_created') AND request_hash IS NULL))
);
INSERT INTO case_access_events(tenant_id,case_id,version,action,owner_id,reason)
 SELECT tenant_id,id,1,'legacy_checkpoint',owner_user_id,'Observed owner at migration; earlier collaborator grants and decisions are not reconstructed.' FROM cases;
CREATE FUNCTION initialise_case_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO case_access_events(tenant_id,case_id,version,action,owner_id,actor_id,actor_name,reason)
 SELECT NEW.tenant_id,NEW.id,1,'case_created',NEW.owner_user_id,NEW.owner_user_id,u.display_name,'Case created with the initiating investigator as owner.' FROM users u WHERE u.id=NEW.owner_user_id;
 RETURN NEW;
END $$;
CREATE TRIGGER case_access_initial AFTER INSERT ON cases FOR EACH ROW EXECUTE FUNCTION initialise_case_access();
ALTER TABLE cases ADD CONSTRAINT case_access_head_fk FOREIGN KEY(tenant_id,id,access_version,owner_user_id)
 REFERENCES case_access_events(tenant_id,case_id,version,owner_id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION preserve_case_access_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.access_version,NEW.owner_user_id) IS DISTINCT FROM (OLD.access_version,OLD.owner_user_id) AND NEW.access_version<>OLD.access_version+1 THEN
  RAISE EXCEPTION 'Case access must advance exactly one immutable version' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_access_head_monotonic BEFORE UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION preserve_case_access_head();
CREATE TRIGGER case_access_history_immutable BEFORE UPDATE OR DELETE ON case_access_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON case_access_events TO inveos_app;
GRANT DELETE ON case_memberships TO inveos_app;
