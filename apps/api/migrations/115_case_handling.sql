-- Current handling controls never rewrite originals, authority or release history.
CREATE TABLE case_handling_events (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 tier text NOT NULL CHECK(tier IN ('standard','sensitive','restricted')),
 sharing text NOT NULL CHECK(sharing IN ('existing_release_controls','internal_only')),
 instructions text NOT NULL CHECK(length(btrim(instructions)) BETWEEN 10 AND 2000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 authority_version integer,actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,case_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 CHECK(sharing='internal_only' OR authority_version IS NOT NULL),CHECK(version<1000 OR sharing='internal_only')
);
CREATE TRIGGER case_handling_immutable BEFORE UPDATE OR DELETE ON case_handling_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION case_handling_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_version integer; current_authority integer; current_status text; current_stage text;
BEGIN
 SELECT authority_version,status,lifecycle_state INTO current_authority,current_status,current_stage FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT COALESCE(max(version),0) INTO previous_version FROM case_handling_events WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id;
 IF NEW.version<>previous_version+1 OR NEW.authority_version IS DISTINCT FROM current_authority OR
 NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.actor_id AND m.role='reviewer' AND cm.case_id=NEW.case_id) OR
 (NEW.sharing='existing_release_controls' AND (current_status<>'Active' OR current_stage NOT IN ('Active','Review','Released'))) THEN
  RAISE EXCEPTION 'Handling requires the current authority, next version and assigned reviewer; enabling sharing requires an active case' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_handling_sequence BEFORE INSERT ON case_handling_events FOR EACH ROW EXECUTE FUNCTION case_handling_sequence();
GRANT SELECT,INSERT ON case_handling_events TO inveos_app;
