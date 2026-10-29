CREATE TABLE case_work_items (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('objective', 'question', 'hypothesis', 'task', 'note', 'handover')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  body text NOT NULL CHECK (length(body) <= 12000),
  status text NOT NULL,
  owner_id uuid,
  due_date date,
  parent_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  request_hash char(64) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id),
  FOREIGN KEY (tenant_id, owner_id) REFERENCES memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, case_id, parent_id) REFERENCES case_work_items(tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id),
  CHECK (
    (kind = 'objective' AND status IN ('Open', 'In progress', 'Blocked', 'Complete')) OR
    (kind = 'task' AND status IN ('To do', 'In progress', 'Blocked', 'Complete')) OR
    (kind = 'question' AND status IN ('Open', 'In progress', 'Blocked', 'Resolved')) OR
    (kind = 'hypothesis' AND status IN ('Proposed', 'Supported', 'Disputed', 'Rejected')) OR
    (kind = 'note' AND status = 'Recorded') OR
    (kind = 'handover' AND status IN ('Open', 'Acknowledged'))
  )
);

CREATE INDEX case_work_owner_idx ON case_work_items (tenant_id, case_id, owner_id, status, due_date);

CREATE TABLE case_work_revisions (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  item_id uuid NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  actor_id uuid NOT NULL,
  actor_name text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, case_id, item_id, version),
  FOREIGN KEY (tenant_id, case_id, item_id) REFERENCES case_work_items(tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES memberships(tenant_id, user_id)
);

CREATE TRIGGER case_work_revisions_append_only BEFORE UPDATE OR DELETE ON case_work_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TABLE case_work_links (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id uuid NOT NULL,
  item_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('supports', 'contradicts', 'context')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, case_id, id),
  UNIQUE (tenant_id, case_id, item_id, claim_id, relation),
  FOREIGN KEY (tenant_id, case_id, item_id) REFERENCES case_work_items(tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, claim_id) REFERENCES claims(tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
);

CREATE TRIGGER case_work_links_append_only BEFORE UPDATE OR DELETE ON case_work_links
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

GRANT SELECT, INSERT, UPDATE ON case_work_items TO inveos_app;
GRANT SELECT, INSERT ON case_work_revisions, case_work_links TO inveos_app;
