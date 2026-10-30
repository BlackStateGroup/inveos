-- Internal fictional declarations only. No commercial, tax or payment activation.
CREATE TABLE agency_billing_declarations (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,currency text NOT NULL CHECK(currency IN ('GBP','EUR','USD')),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('declared','revised','withdrawn')),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 recipient_id uuid NOT NULL REFERENCES users(id),recipient_name text NOT NULL,
 authority_version integer NOT NULL,fields jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,currency,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 CHECK(fields->>'currency'=currency),CHECK(fields->>'recipientId'=recipient_id::text),
 CHECK(fields->>'fictional'='true'),CHECK(fields->>'expenseTreatment'='at_cost'),CHECK(fields->>'rounding'='per_line_half_up')
);
CREATE TRIGGER agency_declarations_immutable BEFORE UPDATE OR DELETE ON agency_billing_declarations FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION agency_declaration_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous agency_billing_declarations%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO previous FROM agency_billing_declarations WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND currency=NEW.currency ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous.version,0)+1 OR
 (NEW.action='declared' AND previous.version IS NOT NULL AND previous.action<>'withdrawn') OR
 (NEW.action IN ('revised','withdrawn') AND (previous.version IS NULL OR previous.action='withdrawn')) OR
 (NEW.action='withdrawn' AND (NEW.fields IS DISTINCT FROM previous.fields OR NEW.recipient_id<>previous.recipient_id OR NEW.authority_version<>previous.authority_version)) THEN
  RAISE EXCEPTION 'Billing declarations must retain sequential history and withdrawal preserves its declaration' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_declaration_sequence BEFORE INSERT ON agency_billing_declarations FOR EACH ROW EXECUTE FUNCTION agency_declaration_sequence();
GRANT SELECT,INSERT ON agency_billing_declarations TO inveos_app;
