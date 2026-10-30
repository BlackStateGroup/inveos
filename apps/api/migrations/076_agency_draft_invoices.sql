CREATE TABLE agency_invoices (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TABLE agency_invoice_revisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,invoice_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action IN ('compiled','corrected','withdrawn')),
 currency text NOT NULL CHECK(currency IN ('GBP','EUR','USD')),declaration_version integer NOT NULL,
 recipient_id uuid NOT NULL REFERENCES users(id),authority_version integer NOT NULL,
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 3 AND 100),
 snapshot_bytes bytea NOT NULL CHECK(octet_length(snapshot_bytes) BETWEEN 1 AND 2097152),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),previous_sha256 char(64),
 net_minor bigint NOT NULL CHECK(net_minor BETWEEN 0 AND 5000000000000),
 tax_minor bigint NOT NULL CHECK(tax_minor BETWEEN 0 AND 5000000000000),
 total_minor bigint NOT NULL CHECK(total_minor=net_minor+tax_minor),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,invoice_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,invoice_id) REFERENCES agency_invoices(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,currency,declaration_version) REFERENCES agency_billing_declarations(tenant_id,case_id,currency,version),
 CHECK((action='compiled')=(version=1)),CHECK((previous_sha256 IS NULL)=(version=1))
);
ALTER TABLE agency_invoices ADD CONSTRAINT agency_invoice_current_fk FOREIGN KEY(tenant_id,case_id,id,version)
 REFERENCES agency_invoice_revisions(tenant_id,case_id,invoice_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE agency_invoice_lines (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,invoice_id uuid NOT NULL,invoice_version integer NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 100),kind text NOT NULL CHECK(kind IN ('time','expense')),
 source_id uuid NOT NULL,source_version integer NOT NULL,
 time_id uuid,expense_id uuid,
 net_minor bigint NOT NULL CHECK(net_minor>=0),tax_minor bigint NOT NULL CHECK(tax_minor>=0),
 PRIMARY KEY(tenant_id,case_id,invoice_id,invoice_version,position),
 UNIQUE(tenant_id,case_id,invoice_id,invoice_version,kind,source_id),
 FOREIGN KEY(tenant_id,case_id,invoice_id,invoice_version) REFERENCES agency_invoice_revisions(tenant_id,case_id,invoice_id,version),
 FOREIGN KEY(tenant_id,case_id,time_id,source_version) REFERENCES case_time_entry_revisions(tenant_id,case_id,entry_id,version),
 FOREIGN KEY(tenant_id,case_id,expense_id,source_version) REFERENCES case_expense_revisions(tenant_id,case_id,expense_id,version),
 CHECK((kind='time' AND time_id IS NOT NULL AND time_id=source_id AND expense_id IS NULL) OR (kind='expense' AND expense_id IS NOT NULL AND expense_id=source_id AND time_id IS NULL))
);
CREATE INDEX agency_invoice_line_sources ON agency_invoice_lines(tenant_id,case_id,kind,source_id);
CREATE TABLE agency_invoice_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,invoice_id uuid NOT NULL,version integer NOT NULL,
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),accepted boolean NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,invoice_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,invoice_id,version) REFERENCES agency_invoice_revisions(tenant_id,case_id,invoice_id,version)
);
CREATE TRIGGER agency_invoice_revisions_immutable BEFORE UPDATE OR DELETE ON agency_invoice_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER agency_invoice_lines_immutable BEFORE UPDATE OR DELETE ON agency_invoice_lines FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER agency_invoice_reviews_immutable BEFORE UPDATE OR DELETE ON agency_invoice_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER agency_invoice_no_delete BEFORE DELETE ON agency_invoices FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION agency_invoice_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 OR
 EXISTS(SELECT 1 FROM agency_invoice_revisions r WHERE r.tenant_id=OLD.tenant_id AND r.case_id=OLD.case_id AND r.invoice_id=OLD.id AND r.version=OLD.version AND r.action='withdrawn') THEN
  RAISE EXCEPTION 'Invoice identity is immutable and withdrawal is terminal' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_invoice_head BEFORE UPDATE ON agency_invoices FOR EACH ROW EXECUTE FUNCTION agency_invoice_head();
-- All writers serialise on the case, including direct restricted-role SQL.
CREATE FUNCTION agency_invoice_case_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_invoice_case_lock BEFORE INSERT OR UPDATE ON agency_invoices FOR EACH ROW EXECUTE FUNCTION agency_invoice_case_lock();
CREATE TRIGGER agency_invoice_revision_case_lock BEFORE INSERT ON agency_invoice_revisions FOR EACH ROW EXECUTE FUNCTION agency_invoice_case_lock();
CREATE TRIGGER agency_invoice_line_case_lock BEFORE INSERT ON agency_invoice_lines FOR EACH ROW EXECUTE FUNCTION agency_invoice_case_lock();
CREATE FUNCTION agency_invoice_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision agency_invoice_revisions%ROWTYPE; head_version integer; line_count integer; net_sum bigint; tax_sum bigint;
BEGIN
 SELECT version INTO head_version FROM agency_invoices WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.invoice_id;
 SELECT * INTO revision FROM agency_invoice_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND invoice_id=NEW.invoice_id AND version=NEW.version;
 SELECT count(*),COALESCE(sum(net_minor),0),COALESCE(sum(tax_minor),0) INTO line_count,net_sum,tax_sum FROM agency_invoice_lines WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND invoice_id=NEW.invoice_id AND invoice_version=NEW.version;
 IF line_count NOT BETWEEN 1 AND 100 OR line_count<>jsonb_array_length(convert_from(revision.snapshot_bytes,'UTF8')::jsonb->'lines') OR net_sum<>revision.net_minor OR tax_sum<>revision.tax_minor OR head_version<NEW.version OR
 (NEW.version>1 AND NOT EXISTS(SELECT 1 FROM agency_invoice_revisions p WHERE p.tenant_id=NEW.tenant_id AND p.case_id=NEW.case_id AND p.invoice_id=NEW.invoice_id AND p.version=NEW.version-1 AND p.sha256=NEW.previous_sha256 AND p.action<>'withdrawn')) THEN
  RAISE EXCEPTION 'Invoice revision, lineage and line totals must agree' USING ERRCODE='55000';
 END IF;
 IF head_version=NEW.version AND NEW.action<>'withdrawn' AND EXISTS(
  SELECT 1 FROM agency_invoice_lines l JOIN agency_invoice_lines other ON other.tenant_id=l.tenant_id AND other.case_id=l.case_id AND other.kind=l.kind AND other.source_id=l.source_id AND other.invoice_id<>l.invoice_id
  JOIN agency_invoices h ON h.tenant_id=other.tenant_id AND h.case_id=other.case_id AND h.id=other.invoice_id AND h.version=other.invoice_version
  JOIN agency_invoice_revisions r ON r.tenant_id=h.tenant_id AND r.case_id=h.case_id AND r.invoice_id=h.id AND r.version=h.version AND r.action<>'withdrawn'
  WHERE l.tenant_id=NEW.tenant_id AND l.case_id=NEW.case_id AND l.invoice_id=NEW.invoice_id AND l.invoice_version=NEW.version
 ) THEN RAISE EXCEPTION 'A logical source is already reserved by another invoice draft' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER agency_invoice_consistency AFTER INSERT ON agency_invoice_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agency_invoice_consistency();
GRANT SELECT,INSERT ON agency_invoices,agency_invoice_revisions,agency_invoice_lines,agency_invoice_reviews TO inveos_app;
GRANT UPDATE(version) ON agency_invoices TO inveos_app;
