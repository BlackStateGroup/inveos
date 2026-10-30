-- Software registration identities only. Append-only decisions never erase local originals.
CREATE TABLE field_device_events (
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,device_id uuid NOT NULL,
 id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 state text NOT NULL CHECK(state IN ('active','lost','revoked')),
 actor_id uuid NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,user_id,device_id,version),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id,device_id) REFERENCES field_devices(tenant_id,user_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
INSERT INTO field_device_events(tenant_id,user_id,device_id,id,version,state,actor_id,reason,recorded_at)
 SELECT tenant_id,user_id,id,gen_random_uuid(),1,'active',user_id,'Existing software device registration retained',created_at FROM field_devices;
INSERT INTO field_device_events(tenant_id,user_id,device_id,id,version,state,actor_id,reason,recorded_at)
 SELECT tenant_id,user_id,device_id,gen_random_uuid(),2,'revoked',user_id,reason,recorded_at FROM field_device_revocations;
CREATE TRIGGER field_device_events_immutable BEFORE UPDATE OR DELETE ON field_device_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON field_device_events TO inveos_app;
