-- Historical sessions remain intact. Only the configured runtime generation authenticates.
ALTER TABLE sessions ADD COLUMN epoch uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';
CREATE FUNCTION preserve_session_epoch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.epoch IS DISTINCT FROM OLD.epoch THEN RAISE EXCEPTION 'Session generation is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sessions_epoch_immutable BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION preserve_session_epoch();
