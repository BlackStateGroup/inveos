-- Preserve exact historical graph source hashes and add a third scoped source family.
ALTER TABLE graph_relationship_sources ADD COLUMN transcript_finding_id uuid;
ALTER TABLE graph_relationship_sources DROP CONSTRAINT graph_relationship_sources_check;
ALTER TABLE graph_relationship_sources ADD CONSTRAINT graph_source_exactly_one
 CHECK(num_nonnulls(text_finding_id,document_finding_id,transcript_finding_id)=1);
ALTER TABLE graph_relationship_sources ADD CONSTRAINT graph_transcript_source_scope
 FOREIGN KEY(tenant_id,case_id,transcript_finding_id) REFERENCES transcript_findings(tenant_id,case_id,id);
