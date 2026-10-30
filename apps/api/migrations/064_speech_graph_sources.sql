-- Retain historical graph-source fingerprints and add a fourth scoped source family.
ALTER TABLE graph_relationship_sources ADD COLUMN speech_finding_id uuid;
ALTER TABLE graph_relationship_sources DROP CONSTRAINT graph_source_exactly_one;
ALTER TABLE graph_relationship_sources ADD CONSTRAINT graph_source_exactly_one
 CHECK(num_nonnulls(text_finding_id,document_finding_id,transcript_finding_id,speech_finding_id)=1);
ALTER TABLE graph_relationship_sources ADD CONSTRAINT graph_speech_source_scope
 FOREIGN KEY(tenant_id,case_id,speech_finding_id) REFERENCES speech_findings(tenant_id,case_id,id);
