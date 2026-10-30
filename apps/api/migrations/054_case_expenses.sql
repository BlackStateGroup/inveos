CREATE TABLE case_expenses (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 created_by uuid NOT NULL REFERENCES users(id),created_by_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TABLE case_expense_revisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,expense_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action IN ('recorded','corrected','withdrawn')),
 incurred_on date NOT NULL,currency text NOT NULL CHECK(currency IN ('GBP','EUR','USD')),amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 2000),receipt_id uuid,receipt_snapshot jsonb,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,expense_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,expense_id) REFERENCES case_expenses(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,receipt_id) REFERENCES evidence(tenant_id,case_id,id),
 CHECK((receipt_id IS NULL)=(receipt_snapshot IS NULL)),CHECK((action='recorded')=(version=1))
);
ALTER TABLE case_expenses ADD CONSTRAINT case_expense_current_fk FOREIGN KEY(tenant_id,case_id,id,version)
 REFERENCES case_expense_revisions(tenant_id,case_id,expense_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE case_expense_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,expense_id uuid NOT NULL,version integer NOT NULL,
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),accepted boolean NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,expense_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,expense_id,version) REFERENCES case_expense_revisions(tenant_id,case_id,expense_id,version)
);
CREATE INDEX case_expense_recorder ON case_expenses(tenant_id,case_id,created_by,id);
CREATE TRIGGER expense_revisions_immutable BEFORE UPDATE OR DELETE ON case_expense_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER expense_reviews_immutable BEFORE UPDATE OR DELETE ON case_expense_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER expense_no_delete BEFORE DELETE ON case_expenses FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION preserve_expense_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 OR
    EXISTS(SELECT 1 FROM case_expense_revisions r WHERE r.tenant_id=OLD.tenant_id AND r.case_id=OLD.case_id AND r.expense_id=OLD.id AND r.version=OLD.version AND r.action='withdrawn') THEN
  RAISE EXCEPTION 'Expense identity is immutable; withdrawn entries are terminal' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_head BEFORE UPDATE ON case_expenses FOR EACH ROW EXECUTE FUNCTION preserve_expense_head();
GRANT SELECT,INSERT ON case_expenses,case_expense_revisions,case_expense_reviews TO inveos_app;
GRANT UPDATE(version) ON case_expenses TO inveos_app;
CREATE TABLE case_spending_budgets (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,currency text NOT NULL CHECK(currency IN ('GBP','EUR','USD')),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),id uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),action text NOT NULL CHECK(action IN ('allocated','revised','withdrawn')),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 0 AND 1000000000000),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,currency,version),UNIQUE(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TRIGGER spending_budget_immutable BEFORE UPDATE OR DELETE ON case_spending_budgets FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION preserve_spending_budget_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous case_spending_budgets%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO previous FROM case_spending_budgets WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND currency=NEW.currency ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous.version,0)+1 OR
    (NEW.action='allocated' AND previous.version IS NOT NULL AND previous.action<>'withdrawn') OR
    (NEW.action IN ('revised','withdrawn') AND (previous.version IS NULL OR previous.action='withdrawn')) OR
    (NEW.action='withdrawn' AND NEW.amount_minor<>previous.amount_minor) THEN
  RAISE EXCEPTION 'Spending budget history must be sequential and withdrawal preserves the previous allocation' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER spending_budget_sequence BEFORE INSERT ON case_spending_budgets FOR EACH ROW EXECUTE FUNCTION preserve_spending_budget_sequence();
GRANT SELECT,INSERT ON case_spending_budgets TO inveos_app;
