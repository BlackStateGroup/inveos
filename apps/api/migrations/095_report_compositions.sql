-- Append-only, case-scoped named outlines. No free-form text becomes a finding.
CREATE TABLE report_composition_revisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,composition_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 operation_id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL,sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,composition_id,version),UNIQUE(tenant_id,case_id,operation_id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 CHECK(payload->>'format'='inveos_report_outline_v1'),CHECK(payload->>'caseId'=case_id::text),CHECK(payload->>'id'=composition_id::text),CHECK((payload->>'version')::integer=version),
 CHECK(payload->>'state' IN ('active','withdrawn'))
);
CREATE TRIGGER report_composition_immutable BEFORE UPDATE OR DELETE ON report_composition_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION report_composition_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous report_composition_revisions%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO previous FROM report_composition_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND composition_id=NEW.composition_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous.version,0)+1 OR previous.payload->>'state'='withdrawn' OR
 (NEW.payload->>'state'='withdrawn' AND (previous.version IS NULL OR NEW.payload->'outline' IS DISTINCT FROM previous.payload->'outline')) THEN
  RAISE EXCEPTION 'Outline revisions must be sequential; withdrawal retains the outline and is terminal' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_composition_sequence BEFORE INSERT ON report_composition_revisions FOR EACH ROW EXECUTE FUNCTION report_composition_sequence();
CREATE TABLE report_composition_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,composition_id uuid NOT NULL,version integer NOT NULL,
 id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 100),request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 sha256 char(64) NOT NULL,decision text NOT NULL CHECK(decision IN ('accepted','changes_requested')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,composition_id,version,sequence),
 FOREIGN KEY(tenant_id,case_id,composition_id,version) REFERENCES report_composition_revisions(tenant_id,case_id,composition_id,version)
);
CREATE TRIGGER report_composition_reviews_immutable BEFORE UPDATE OR DELETE ON report_composition_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION report_composition_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision report_composition_revisions%ROWTYPE; previous_sequence integer;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO current_revision FROM report_composition_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND composition_id=NEW.composition_id ORDER BY version DESC LIMIT 1;
 SELECT COALESCE(max(sequence),0) INTO previous_sequence FROM report_composition_reviews WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND composition_id=NEW.composition_id AND version=NEW.version;
 IF current_revision.version<>NEW.version OR current_revision.payload->>'state'<>'active' OR current_revision.sha256<>NEW.sha256 OR NEW.sequence<>previous_sequence+1 OR
 EXISTS(SELECT 1 FROM report_composition_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND composition_id=NEW.composition_id AND actor_id=NEW.actor_id) OR
 NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.actor_id AND m.role='reviewer' AND cm.case_id=NEW.case_id) THEN
  RAISE EXCEPTION 'Review requires the current exact outline and an independent case reviewer' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_composition_review_guard BEFORE INSERT ON report_composition_reviews FOR EACH ROW EXECUTE FUNCTION report_composition_review_guard();
GRANT SELECT,INSERT ON report_composition_revisions,report_composition_reviews TO inveos_app;
