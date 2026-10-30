-- Coordination of an exact pending review; no evidence decision or access grant.
CREATE TABLE case_review_assignments (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 item_key text NOT NULL CHECK(length(item_key) BETWEEN 1 AND 200),
 revision text NOT NULL CHECK(length(revision) BETWEEN 1 AND 100),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 expected_version integer NOT NULL CHECK(version=expected_version+1),
 assignee_id uuid REFERENCES users(id),assignee_name text,
 actor_id uuid NOT NULL REFERENCES users(id),actor_name text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,item_key,revision,version),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 CHECK((assignee_id IS NULL)=(assignee_name IS NULL))
);
CREATE TRIGGER case_review_assignment_immutable BEFORE UPDATE OR DELETE ON case_review_assignments
 FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON case_review_assignments TO inveos_app;
-- Reassignment returns the current review to personal reminders without deleting
-- earlier acknowledgements. Existing acknowledgements belong to unassigned v0.
ALTER TABLE attention_acknowledgements ADD COLUMN assignment_version integer NOT NULL DEFAULT 0 CHECK(assignment_version>=0);
ALTER TABLE attention_acknowledgements DROP CONSTRAINT attention_acknowledgements_pkey;
ALTER TABLE attention_acknowledgements ADD PRIMARY KEY(tenant_id,case_id,user_id,item_key,revision,assignment_version);
