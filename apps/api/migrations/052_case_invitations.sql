-- An invitation is an owner offer, not case membership or external identity enrolment.
CREATE TABLE case_invitations (
 tenant_id uuid NOT NULL,id uuid NOT NULL,case_id uuid NOT NULL,recipient_id uuid NOT NULL,
 owner_id uuid NOT NULL,owner_name text NOT NULL,recipient_name text NOT NULL,
 case_ref text NOT NULL,case_title text NOT NULL,authority_version integer NOT NULL,access_version integer NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),valid_for_hours integer NOT NULL CHECK(valid_for_hours BETWEEN 1 AND 168),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,case_id,access_version) REFERENCES case_access_events(tenant_id,case_id,version),
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version),
 CHECK(recipient_id<>owner_id)
);
CREATE INDEX case_invitation_recipient ON case_invitations(tenant_id,recipient_id,id);
CREATE INDEX case_invitation_case ON case_invitations(tenant_id,case_id,id);
CREATE TABLE case_invitation_responses (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,invitation_id uuid NOT NULL,id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accept','decline')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),access_version integer,
 PRIMARY KEY(tenant_id,invitation_id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id,invitation_id) REFERENCES case_invitations(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,access_version) REFERENCES case_access_events(tenant_id,case_id,version),
 CHECK((decision='accept' AND access_version IS NOT NULL) OR (decision='decline' AND access_version IS NULL))
);
CREATE TABLE case_invitation_cancellations (
 tenant_id uuid NOT NULL,invitation_id uuid NOT NULL,id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,invitation_id),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,invitation_id) REFERENCES case_invitations(tenant_id,id)
);
CREATE TRIGGER case_invitation_immutable BEFORE UPDATE OR DELETE ON case_invitations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER case_invitation_response_immutable BEFORE UPDATE OR DELETE ON case_invitation_responses FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER case_invitation_cancel_immutable BEFORE UPDATE OR DELETE ON case_invitation_cancellations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON case_invitations,case_invitation_responses,case_invitation_cancellations TO inveos_app;
