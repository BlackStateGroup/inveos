-- Administrative enrolment only. Issuer/subject never grants a role from token claims.
CREATE TABLE identity_bindings (
 id uuid PRIMARY KEY,
 issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 UNIQUE (issuer,subject),
 UNIQUE (id,tenant_id,user_id),
 FOREIGN KEY (tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE FUNCTION preserve_identity_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.issuer IS DISTINCT FROM OLD.issuer OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN RAISE EXCEPTION 'Identity enrolment is immutable; revoke and use a new subject'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER identity_binding_immutable BEFORE UPDATE ON identity_bindings FOR EACH ROW EXECUTE FUNCTION preserve_identity_binding();
CREATE TRIGGER identity_binding_no_delete BEFORE DELETE ON identity_bindings FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
ALTER TABLE sessions ADD COLUMN identity_id uuid;
ALTER TABLE sessions ADD COLUMN identity_profile_hash char(64);
ALTER TABLE sessions ADD CONSTRAINT sessions_identity_profile CHECK ((identity_id IS NULL AND identity_profile_hash IS NULL) OR (identity_id IS NOT NULL AND identity_profile_hash ~ '^[a-f0-9]{64}$' AND identity_profile_hash IS NOT NULL));
ALTER TABLE sessions ADD CONSTRAINT sessions_identity_owner FOREIGN KEY (identity_id,tenant_id,user_id) REFERENCES identity_bindings(id,tenant_id,user_id);
CREATE FUNCTION preserve_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.identity_profile_hash IS DISTINCT FROM OLD.identity_profile_hash OR NEW.identity_id IS DISTINCT FROM OLD.identity_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Session identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sessions_identity_immutable BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION preserve_session_identity();
CREATE TABLE identity_login_attempts (
 state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
 browser_hash char(64) NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
 provider_hash char(64) NOT NULL CHECK (provider_hash ~ '^[a-f0-9]{64}$'),
 epoch uuid NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX identity_login_expiry ON identity_login_attempts(expires_at);
GRANT SELECT ON identity_bindings TO inveos_app;
GRANT SELECT,INSERT,DELETE ON identity_login_attempts TO inveos_app;
-- Database-admin enrolment/revocation remains accountable even before an agency UI exists.
CREATE TABLE identity_binding_history (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 identity_id uuid NOT NULL REFERENCES identity_bindings(id),
 action text NOT NULL CHECK (action IN ('enrolled','revoked')),
 database_role text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER identity_history_immutable BEFORE UPDATE OR DELETE ON identity_binding_history FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION record_identity_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO identity_binding_history(identity_id,action,database_role) VALUES (NEW.id,'enrolled',current_user);
 ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
  INSERT INTO identity_binding_history(identity_id,action,database_role) VALUES (NEW.id,'revoked',current_user);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER identity_binding_history_record AFTER INSERT OR UPDATE ON identity_bindings FOR EACH ROW EXECUTE FUNCTION record_identity_binding();
