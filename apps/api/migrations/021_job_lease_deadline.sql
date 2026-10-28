-- Existing running leases retain their original expiry and cannot be renewed.
-- A new claim gives each attempt a fixed five-minute renewal ceiling.
ALTER TABLE integrity_jobs ADD COLUMN lease_deadline timestamptz;
ALTER TABLE integrity_jobs ADD CONSTRAINT integrity_lease_deadline
  CHECK (lease_deadline IS NULL OR lease_until IS NULL OR lease_until <= lease_deadline);
CREATE FUNCTION preserve_lease_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lease_token IS NOT DISTINCT FROM NEW.lease_token AND
    OLD.lease_deadline IS NOT NULL AND
    (NEW.lease_deadline IS NULL OR NEW.lease_deadline > OLD.lease_deadline)
  THEN RAISE EXCEPTION 'Attempt deadline cannot be extended' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER integrity_lease_deadline_immutable BEFORE UPDATE ON integrity_jobs
  FOR EACH ROW EXECUTE FUNCTION preserve_lease_deadline();
