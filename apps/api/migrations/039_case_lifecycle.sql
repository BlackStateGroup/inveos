-- Keep operational stage separate from immutable authority and explicit report grants.
ALTER TABLE cases ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'Intake'
 CHECK(lifecycle_state IN ('Intake','Scope review','Active','Review','Released','Closed','Archived'));
ALTER TABLE cases ADD COLUMN lifecycle_version integer NOT NULL DEFAULT 1 CHECK(lifecycle_version BETWEEN 1 AND 1000);
UPDATE cases SET lifecycle_state=status;
ALTER TABLE report_disclosures ADD UNIQUE(tenant_id,case_id,id);
CREATE TABLE case_lifecycle_events (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),from_state text,
 to_state text NOT NULL CHECK(to_state IN ('Intake','Scope review','Active','Review','Released','Closed','Archived')),
 actor_id uuid REFERENCES users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 2000),
 source text NOT NULL CHECK(source IN ('legacy_checkpoint','case_created','authority_approved','investigator_transition')),
 authority_version integer,disclosure_id uuid,request_hash char(64),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((source='legacy_checkpoint' AND actor_id IS NULL) OR (source<>'legacy_checkpoint' AND actor_id IS NOT NULL)),
 PRIMARY KEY(tenant_id,case_id,version),UNIQUE(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,version,to_state),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 FOREIGN KEY(tenant_id,case_id,disclosure_id) REFERENCES report_disclosures(tenant_id,case_id,id)
);
INSERT INTO case_lifecycle_events(tenant_id,case_id,version,to_state,actor_id,reason,source,authority_version)
 SELECT tenant_id,id,1,lifecycle_state,NULL,'Migration checkpoint of existing status; earlier stage history is not reconstructed.','legacy_checkpoint',authority_version FROM cases;
CREATE FUNCTION initialise_case_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO case_lifecycle_events(tenant_id,case_id,version,to_state,actor_id,reason,source)
 VALUES(NEW.tenant_id,NEW.id,1,NEW.lifecycle_state,NEW.owner_user_id,'Case intake recorded; collection requires approved authority.','case_created');
 RETURN NEW;
END $$;
CREATE TRIGGER case_lifecycle_initial AFTER INSERT ON cases FOR EACH ROW EXECUTE FUNCTION initialise_case_lifecycle();
ALTER TABLE cases ADD CONSTRAINT case_lifecycle_head_fk FOREIGN KEY(tenant_id,id,lifecycle_version,lifecycle_state)
 REFERENCES case_lifecycle_events(tenant_id,case_id,version,to_state) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER case_lifecycle_events_immutable BEFORE UPDATE OR DELETE ON case_lifecycle_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON case_lifecycle_events TO inveos_app;

CREATE FUNCTION preserve_case_lifecycle_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.lifecycle_state,NEW.lifecycle_version) IS DISTINCT FROM (OLD.lifecycle_state,OLD.lifecycle_version)
   AND NEW.lifecycle_version<>OLD.lifecycle_version+1 THEN
   RAISE EXCEPTION 'Case lifecycle must advance exactly one immutable version' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_lifecycle_head_monotonic BEFORE UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION preserve_case_lifecycle_head();
