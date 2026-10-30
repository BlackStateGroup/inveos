CREATE TABLE task_plan_batches (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES users(id),
 applied jsonb NOT NULL CHECK(jsonb_typeof(applied)='array' AND jsonb_array_length(applied) BETWEEN 1 AND 50),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TRIGGER task_plan_batch_immutable BEFORE UPDATE OR DELETE ON task_plan_batches FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON task_plan_batches TO inveos_app;
