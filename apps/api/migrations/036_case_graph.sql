CREATE TABLE graph_entities (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TABLE graph_entity_revisions (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, entity_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100), snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,entity_id,version),
 FOREIGN KEY(tenant_id,case_id,entity_id) REFERENCES graph_entities(tenant_id,case_id,id)
);
CREATE TABLE graph_relationships (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id)
);
CREATE TABLE graph_relationship_revisions (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, relationship_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 from_id uuid NOT NULL, from_version integer NOT NULL, to_id uuid NOT NULL, to_version integer NOT NULL,
 snapshot jsonb NOT NULL, digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,relationship_id,version),
 FOREIGN KEY(tenant_id,case_id,relationship_id) REFERENCES graph_relationships(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,from_id,from_version) REFERENCES graph_entity_revisions(tenant_id,case_id,entity_id,version),
 FOREIGN KEY(tenant_id,case_id,to_id,to_version) REFERENCES graph_entity_revisions(tenant_id,case_id,entity_id,version),
 CHECK(from_id<>to_id)
);
CREATE TABLE graph_relationship_sources (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, relationship_id uuid NOT NULL, version integer NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 4),
 text_finding_id uuid, document_finding_id uuid,
 source_hash char(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'), authority_version integer NOT NULL CHECK(authority_version>0),
 PRIMARY KEY(tenant_id,case_id,relationship_id,version,ordinal),
 FOREIGN KEY(tenant_id,case_id,relationship_id,version) REFERENCES graph_relationship_revisions(tenant_id,case_id,relationship_id,version),
 FOREIGN KEY(tenant_id,case_id,text_finding_id) REFERENCES findings(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,document_finding_id) REFERENCES document_findings(tenant_id,case_id,id),
 CHECK((text_finding_id IS NULL)<>(document_finding_id IS NULL))
);
CREATE TABLE graph_relationship_reviews (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, relationship_id uuid NOT NULL, version integer NOT NULL,
 id uuid NOT NULL, digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 accepted boolean NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 3000),
 reviewer_id uuid NOT NULL REFERENCES users(id), reviewer_name text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,relationship_id,version),
 UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,relationship_id,version) REFERENCES graph_relationship_revisions(tenant_id,case_id,relationship_id,version)
);
CREATE TRIGGER graph_entity_history_immutable BEFORE UPDATE OR DELETE ON graph_entity_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER graph_relationship_history_immutable BEFORE UPDATE OR DELETE ON graph_relationship_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER graph_source_immutable BEFORE UPDATE OR DELETE ON graph_relationship_sources FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER graph_review_immutable BEFORE UPDATE OR DELETE ON graph_relationship_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER graph_entity_no_delete BEFORE DELETE ON graph_entities FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER graph_relationship_no_delete BEFORE DELETE ON graph_relationships FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON graph_entities,graph_entity_revisions,graph_relationships,graph_relationship_revisions,graph_relationship_sources,graph_relationship_reviews TO inveos_app;
GRANT UPDATE(version) ON graph_entities,graph_relationships TO inveos_app;
