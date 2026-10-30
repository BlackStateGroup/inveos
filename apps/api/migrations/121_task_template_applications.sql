CREATE TABLE case_task_template_previews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,template_id uuid NOT NULL,template_version integer NOT NULL,template_sha256 char(64) NOT NULL,
 review_id uuid NOT NULL,payload jsonb NOT NULL,sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),request_hash char(64) NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id,template_id,template_version) REFERENCES case_task_template_revisions(tenant_id,case_id,template_id,version),
 FOREIGN KEY(tenant_id,case_id,review_id) REFERENCES case_task_template_reviews(tenant_id,case_id,id),CHECK(expires_at>created_at),
 CHECK(payload->>'format'='inveos_task_template_preview_v1'),CHECK(payload->>'caseId'=case_id::text),CHECK(payload->>'id'=id::text),CHECK(payload->>'templateId'=template_id::text),CHECK((payload->>'templateVersion')::int=template_version)
);
CREATE TABLE case_task_template_applications (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,preview_sha256 char(64) NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),FOREIGN KEY(tenant_id,case_id,id) REFERENCES case_task_template_previews(tenant_id,case_id,id)
);
CREATE TABLE case_task_template_application_items (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,application_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 1 AND 50),entry_id uuid NOT NULL,work_id uuid NOT NULL,work_version integer NOT NULL DEFAULT 1 CHECK(work_version=1),
 PRIMARY KEY(tenant_id,case_id,application_id,position),UNIQUE(tenant_id,case_id,application_id,entry_id),UNIQUE(tenant_id,case_id,work_id),
 FOREIGN KEY(tenant_id,case_id,application_id) REFERENCES case_task_template_applications(tenant_id,case_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,case_id,work_id,work_version) REFERENCES case_work_revisions(tenant_id,case_id,item_id,version)
);
CREATE TRIGGER case_task_template_preview_immutable BEFORE UPDATE OR DELETE ON case_task_template_previews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER case_task_template_application_immutable BEFORE UPDATE OR DELETE ON case_task_template_applications FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER case_task_template_application_item_immutable BEFORE UPDATE OR DELETE ON case_task_template_application_items FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE FUNCTION task_template_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE preview case_task_template_previews%ROWTYPE; latest_review case_task_template_reviews%ROWTYPE; current_state text; selected_count integer;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO preview FROM case_task_template_previews WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.id;
 SELECT payload->>'state' INTO current_state FROM case_task_template_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND template_id=preview.template_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO latest_review FROM case_task_template_reviews WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND template_id=preview.template_id AND version=preview.template_version ORDER BY sequence DESC LIMIT 1;
 SELECT count(*) INTO selected_count FROM case_task_template_application_items WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND application_id=NEW.id;
 IF preview.actor_id IS DISTINCT FROM NEW.actor_id OR preview.sha256 IS DISTINCT FROM NEW.preview_sha256 OR preview.expires_at<=clock_timestamp() OR current_state IS DISTINCT FROM 'active' OR latest_review.id IS DISTINCT FROM preview.review_id OR latest_review.decision IS DISTINCT FROM 'accepted' OR latest_review.sha256 IS DISTINCT FROM preview.template_sha256 OR NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND cm.case_id=NEW.case_id AND m.user_id=latest_review.actor_id AND m.role='reviewer') OR selected_count<>jsonb_array_length(preview.payload->'entries') THEN
  RAISE EXCEPTION 'Application requires an unexpired exact preview, current acceptance and complete atomic work set' USING ERRCODE='P0121';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_task_template_application_guard BEFORE INSERT ON case_task_template_applications FOR EACH ROW EXECUTE FUNCTION task_template_application_guard();
GRANT SELECT,INSERT ON case_task_template_previews,case_task_template_applications,case_task_template_application_items TO inveos_app;
