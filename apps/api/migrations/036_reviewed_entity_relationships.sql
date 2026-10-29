-- Candidate identities and relationships are case working context.  They do not
-- alter evidence, claims, findings or a report until separately used by a reviewer.
CREATE TABLE intelligence_entities (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
 entity_type text NOT NULL CHECK(entity_type IN ('person','organisation','place','other')),
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE intelligence_entity_revisions (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, entity_id uuid NOT NULL, version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 snapshot jsonb NOT NULL, actor_id uuid NOT NULL, actor_name text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,entity_id,version),
 FOREIGN KEY(tenant_id,case_id,entity_id) REFERENCES intelligence_entities(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE intelligence_relationships (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
 from_entity_id uuid NOT NULL, to_entity_id uuid NOT NULL,
 relationship_type text NOT NULL CHECK(relationship_type IN ('associated_with','controls','employed_by','contracted_with','located_at','other')),
 status text NOT NULL CHECK(status IN ('candidate','confirmed','rejected')),
 source_kind text NOT NULL CHECK(source_kind IN ('text_finding','document_finding')),
 source_finding_id uuid NOT NULL, rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 3000),
 created_by uuid NOT NULL, reviewed_by uuid, reviewed_at timestamptz, review_reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 CHECK(from_entity_id <> to_entity_id),
 CHECK((status='candidate' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL) OR (status IN ('confirmed','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(btrim(review_reason))>0)),
 FOREIGN KEY(tenant_id,case_id,from_entity_id) REFERENCES intelligence_entities(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,to_entity_id) REFERENCES intelligence_entities(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,reviewed_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX intelligence_relationships_case_status ON intelligence_relationships(tenant_id,case_id,status,id);
CREATE TRIGGER intelligence_entity_revisions_append_only BEFORE UPDATE OR DELETE ON intelligence_entity_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER intelligence_relationships_append_only BEFORE DELETE ON intelligence_relationships FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT,UPDATE(version) ON intelligence_entities TO inveos_app;
GRANT SELECT,INSERT ON intelligence_entity_revisions TO inveos_app;
GRANT SELECT,INSERT,UPDATE(status,reviewed_by,reviewed_at,review_reason) ON intelligence_relationships TO inveos_app;
