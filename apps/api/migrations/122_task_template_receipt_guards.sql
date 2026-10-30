CREATE FUNCTION task_template_application_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE preview case_task_template_previews%ROWTYPE; entry jsonb; revision case_work_revisions%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO preview FROM case_task_template_previews WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.application_id;
 entry=preview.payload->'entries'->(NEW.position-1);
 SELECT * INTO revision FROM case_work_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND item_id=NEW.work_id AND version=1;
 IF EXISTS(SELECT 1 FROM case_task_template_applications WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.application_id) OR
  entry IS NULL OR entry->>'entryId' IS DISTINCT FROM NEW.entry_id::text OR entry->>'workId' IS DISTINCT FROM NEW.work_id::text OR
  revision.actor_id IS DISTINCT FROM preview.actor_id OR revision.source_links IS DISTINCT FROM '[]'::jsonb OR
  revision.snapshot->'parentId' IS DISTINCT FROM 'null'::jsonb OR
  revision.snapshot->>'kind' IS DISTINCT FROM entry->>'kind' OR revision.snapshot->>'title' IS DISTINCT FROM entry->>'title' OR revision.snapshot->>'body' IS DISTINCT FROM entry->>'body' OR
  revision.snapshot->'ownerId' IS DISTINCT FROM entry->'ownerId' OR revision.snapshot->'dueDate' IS DISTINCT FROM entry->'dueDate' OR
  revision.snapshot->>'status' IS DISTINCT FROM (CASE entry->>'kind' WHEN 'task' THEN 'To do' WHEN 'objective' THEN 'Open' WHEN 'question' THEN 'Open' WHEN 'note' THEN 'Recorded' ELSE NULL END) THEN
  RAISE EXCEPTION 'Application line must match the exact preview and source-free initial work revision; completed receipts are immutable' USING ERRCODE='P0121';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_task_template_application_item_guard BEFORE INSERT ON case_task_template_application_items FOR EACH ROW EXECUTE FUNCTION task_template_application_item_guard();
