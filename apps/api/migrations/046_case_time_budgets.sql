CREATE TABLE case_time_budgets (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action IN ('allocated','revised','withdrawn')),
 minutes integer NOT NULL CHECK(minutes BETWEEN 0 AND 14400000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TRIGGER case_budget_immutable BEFORE UPDATE OR DELETE ON case_time_budgets FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION preserve_case_budget_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous case_time_budgets%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO previous FROM case_time_budgets WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous.version,0)+1 OR
    (NEW.action='allocated' AND previous.version IS NOT NULL AND previous.action<>'withdrawn') OR
    (NEW.action IN ('revised','withdrawn') AND (previous.version IS NULL OR previous.action='withdrawn')) OR
    (NEW.action='withdrawn' AND NEW.minutes<>previous.minutes) THEN
  RAISE EXCEPTION 'Budget history must be sequential and withdrawal preserves the previous allocation' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_budget_sequence BEFORE INSERT ON case_time_budgets FOR EACH ROW EXECUTE FUNCTION preserve_case_budget_sequence();
GRANT SELECT,INSERT ON case_time_budgets TO inveos_app;
