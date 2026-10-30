CREATE TABLE field_case_grants (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,user_id uuid NOT NULL,device_id uuid NOT NULL,
 id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 state text NOT NULL CHECK(state IN ('granted','withdrawn')),
 device_version integer NOT NULL,authority_id uuid NOT NULL,authority_version integer NOT NULL,access_version integer NOT NULL,
 actor_id uuid NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,user_id,device_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,user_id,device_id,device_version) REFERENCES field_device_events(tenant_id,user_id,device_id,version),
 FOREIGN KEY(tenant_id,case_id,authority_id,authority_version) REFERENCES authority_records(tenant_id,case_id,id,version),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id),
 CHECK(expires_at>recorded_at AND expires_at<=recorded_at+interval '7 days')
);
CREATE TRIGGER field_case_grants_immutable BEFORE UPDATE OR DELETE ON field_case_grants FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON field_case_grants TO inveos_app;
