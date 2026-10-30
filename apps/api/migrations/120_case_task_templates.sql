-- Case-local, separately authored boilerplate; no source/reference or default owner fields.
CREATE TABLE case_task_template_revisions (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,template_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 id uuid NOT NULL,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),payload jsonb NOT NULL,
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tenant_id,case_id,template_id,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 CHECK(payload->>'format'='inveos_case_task_template_v1'),CHECK(payload->>'caseId'=case_id::text),CHECK(payload->>'id'=template_id::text),
 CHECK((payload->>'version')::int=version),CHECK(payload->>'state' IN ('active','withdrawn'))
);
CREATE TABLE case_task_template_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,template_id uuid NOT NULL,version integer NOT NULL,id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 100),request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),decision text NOT NULL CHECK(decision IN ('accepted','changes_requested')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,template_id,version,sequence),
 FOREIGN KEY(tenant_id,case_id,template_id,version) REFERENCES case_task_template_revisions(tenant_id,case_id,template_id,version)
);
CREATE TRIGGER case_task_template_immutable BEFORE UPDATE OR DELETE ON case_task_template_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER case_task_template_review_immutable BEFORE UPDATE OR DELETE ON case_task_template_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION case_task_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous case_task_template_revisions%ROWTYPE; target case_task_template_revisions%ROWTYPE; previous_sequence integer;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO previous FROM case_task_template_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND template_id=NEW.template_id ORDER BY version DESC LIMIT 1;
 IF TG_TABLE_NAME='case_task_template_revisions' THEN
  IF NEW.version<>COALESCE(previous.version,0)+1 OR previous.payload->>'state'='withdrawn' OR
   (NEW.payload->>'state'='withdrawn' AND (previous.version IS NULL OR NEW.payload->'fields' IS DISTINCT FROM previous.payload->'fields')) THEN
   RAISE EXCEPTION 'Template revisions must be sequential; withdrawal preserves boilerplate and is terminal' USING ERRCODE='55000';
  END IF;
 ELSE
  SELECT * INTO target FROM case_task_template_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND template_id=NEW.template_id AND version=NEW.version;
  SELECT COALESCE(max(sequence),0) INTO previous_sequence FROM case_task_template_reviews WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND template_id=NEW.template_id AND version=NEW.version;
  IF previous.payload->>'state'='withdrawn' OR target.payload->>'state'<>'active' OR target.sha256<>NEW.sha256 OR NEW.sequence<>previous_sequence+1 OR
   EXISTS(SELECT 1 FROM case_task_template_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND template_id=NEW.template_id AND actor_id=NEW.actor_id) OR
   NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.actor_id AND m.role='reviewer' AND cm.case_id=NEW.case_id) THEN
   RAISE EXCEPTION 'Template acceptance requires exact version/digest and an independent current case reviewer' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_task_template_guard BEFORE INSERT ON case_task_template_revisions FOR EACH ROW EXECUTE FUNCTION case_task_template_guard();
CREATE TRIGGER case_task_template_review_guard BEFORE INSERT ON case_task_template_reviews FOR EACH ROW EXECUTE FUNCTION case_task_template_guard();
GRANT SELECT,INSERT ON case_task_template_revisions,case_task_template_reviews TO inveos_app;
