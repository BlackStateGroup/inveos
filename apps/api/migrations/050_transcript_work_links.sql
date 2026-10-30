-- Retain the existing link identities/history; each link has exactly one typed source.
ALTER TABLE case_work_links ADD COLUMN transcript_finding_id uuid;
ALTER TABLE case_work_links DROP CONSTRAINT work_link_exactly_one_source;
ALTER TABLE case_work_links ADD CONSTRAINT work_link_exactly_one_source
 CHECK (num_nonnulls(claim_id,document_finding_id,transcript_finding_id)=1);
ALTER TABLE case_work_links ADD CONSTRAINT work_link_transcript_scope
 FOREIGN KEY (tenant_id,case_id,transcript_finding_id) REFERENCES transcript_findings(tenant_id,case_id,id);
CREATE UNIQUE INDEX work_link_transcript_identity ON case_work_links(tenant_id,case_id,item_id,transcript_finding_id,relation)
 WHERE transcript_finding_id IS NOT NULL;
