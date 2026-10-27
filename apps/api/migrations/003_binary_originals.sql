-- Opaque originals remain quarantined until a separately reviewed processing
-- pipeline can attach derivatives. Digest equality is not a malware clearance.
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS original_kind text NOT NULL DEFAULT 'original_utf8';
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_status_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_status_check CHECK (
  (original_kind = 'original_utf8' AND status = 'Verified') OR
  (original_kind = 'opaque_binary' AND status = 'Quarantined')
);

-- Preserve the original-byte claim contract even if a caller bypasses the API.
CREATE OR REPLACE FUNCTION require_text_claim_original()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM evidence
     WHERE tenant_id = NEW.tenant_id AND case_id = NEW.case_id AND id = NEW.evidence_id
       AND original_kind <> 'original_utf8'
  ) THEN
    RAISE EXCEPTION 'Original-byte claims require a text original' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS claims_text_original ON claims;
CREATE TRIGGER claims_text_original BEFORE INSERT OR UPDATE ON claims
FOR EACH ROW EXECUTE FUNCTION require_text_claim_original();
