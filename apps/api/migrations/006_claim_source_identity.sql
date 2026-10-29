-- A review may change state/reason; it must never rewrite the assertion or source it reviewed.
CREATE FUNCTION preserve_claim_source_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id,NEW.case_id,NEW.id,NEW.evidence_id,NEW.authority_id,NEW.authority_version,
      NEW.text,NEW.quote,NEW.source_start_byte,NEW.source_end_byte,NEW.source_digest,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM
    (OLD.tenant_id,OLD.case_id,OLD.id,OLD.evidence_id,OLD.authority_id,OLD.authority_version,
      OLD.text,OLD.quote,OLD.source_start_byte,OLD.source_end_byte,OLD.source_digest,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Claim assertion and source identity are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER claim_source_identity BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION preserve_claim_source_identity();
