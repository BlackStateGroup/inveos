CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('reviewer', 'investigator', 'client')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS cases (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL,
  ref text NOT NULL,
  title text NOT NULL,
  client text NOT NULL,
  category text NOT NULL DEFAULT 'Synthetic investigation',
  status text NOT NULL DEFAULT 'Scope review' CHECK (status IN ('Scope review', 'Active')),
  owner_user_id uuid NOT NULL,
  due text NOT NULL DEFAULT 'Not set',
  scope text NOT NULL,
  jurisdiction text NOT NULL,
  authority_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES memberships(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS case_memberships (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, case_id, user_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS authority_records (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  purpose text NOT NULL,
  lawful_basis text NOT NULL,
  scope text NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  minimisation text NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, case_id, id),
  UNIQUE (tenant_id, case_id, version),
  UNIQUE (tenant_id, case_id, id, version),
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES memberships(tenant_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cases_current_authority_fk'
      AND conrelid = 'cases'::regclass
  ) THEN
    ALTER TABLE cases
      ADD CONSTRAINT cases_current_authority_fk
      FOREIGN KEY (tenant_id, id, authority_version)
      REFERENCES authority_records(tenant_id, case_id, version)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS evidence (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id uuid NOT NULL,
  authority_id uuid NOT NULL,
  authority_version integer NOT NULL,
  filename text NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 262144),
  source_time text NOT NULL,
  received_time timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL,
  digest char(64) NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  object_path text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status = 'Verified'),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, case_id, id),
  UNIQUE (tenant_id, case_id, created_by, idempotency_key),
  UNIQUE (tenant_id, case_id, id, authority_id, authority_version),
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id),
  FOREIGN KEY (tenant_id, case_id, authority_id, authority_version)
    REFERENCES authority_records(tenant_id, case_id, id, version),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS claims (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  authority_id uuid NOT NULL,
  authority_version integer NOT NULL,
  text text NOT NULL,
  quote text NOT NULL,
  source_start_byte integer NOT NULL CHECK (source_start_byte >= 0),
  source_end_byte integer NOT NULL CHECK (source_end_byte > source_start_byte),
  source_digest char(64) NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('Under review', 'Accepted', 'Rejected')),
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, evidence_id, authority_id, authority_version)
    REFERENCES evidence(tenant_id, case_id, id, authority_id, authority_version),
  FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id uuid NOT NULL,
  claim_id uuid NOT NULL,
  accepted boolean NOT NULL,
  reason text NOT NULL,
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  source_digest char(64) NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  source_start_byte integer NOT NULL,
  source_end_byte integer NOT NULL,
  PRIMARY KEY (tenant_id, case_id, id),
  UNIQUE (tenant_id, case_id, claim_id),
  FOREIGN KEY (tenant_id, case_id, claim_id) REFERENCES claims(tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, reviewed_by) REFERENCES memberships(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS findings (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id uuid NOT NULL,
  claim_id uuid NOT NULL,
  review_id uuid NOT NULL,
  text text NOT NULL,
  reviewer_user_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, case_id, id),
  UNIQUE (tenant_id, case_id, claim_id),
  UNIQUE (tenant_id, case_id, review_id),
  FOREIGN KEY (tenant_id, case_id, claim_id) REFERENCES claims(tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, case_id, review_id) REFERENCES reviews(tenant_id, case_id, id),
  FOREIGN KEY (tenant_id, reviewer_user_id) REFERENCES memberships(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  tenant_id uuid NOT NULL,
  case_id uuid,
  id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES memberships(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS audit_events_case_time_idx
  ON audit_events (tenant_id, case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  id uuid NOT NULL UNIQUE,
  csrf_hash char(64) NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id)
);

CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['authority_records', 'evidence', 'reviews', 'findings', 'audit_events']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation()',
      table_name,
      table_name
    );
  END LOOP;
END
$$;

INSERT INTO tenants (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Fictional INVEOS Local Lab')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, display_name)
VALUES ('00000000-0000-4000-8000-000000000002', 'Synthetic reviewer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (tenant_id, user_id, role)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'reviewer'
)
ON CONFLICT (tenant_id, user_id) DO NOTHING;

DO $$
DECLARE
  schema_name text := current_schema();
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO inveos_app', schema_name);
  EXECUTE format('GRANT SELECT ON tenants, users, memberships TO inveos_app');
  EXECUTE format('GRANT SELECT, INSERT ON case_memberships TO inveos_app');
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON cases TO inveos_app');
  EXECUTE format('GRANT SELECT, INSERT ON authority_records TO inveos_app');
  EXECUTE format('GRANT SELECT, INSERT ON evidence TO inveos_app');
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON claims TO inveos_app');
  EXECUTE format('GRANT SELECT, INSERT ON reviews, findings, audit_events TO inveos_app');
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON sessions TO inveos_app');
END
$$;
