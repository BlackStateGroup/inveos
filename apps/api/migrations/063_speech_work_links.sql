-- Preserve previous source links; each new speech link has a same-case finding.
ALTER TABLE case_work_links ADD COLUMN speech_finding_id uuid;
ALTER TABLE case_work_links DROP CONSTRAINT work_link_exactly_one_source;
ALTER TABLE case_work_links ADD CONSTRAINT work_link_exactly_one_source
 CHECK(num_nonnulls(claim_id,document_finding_id,transcript_finding_id,speech_finding_id)=1);
ALTER TABLE case_work_links ADD CONSTRAINT work_link_speech_scope
 FOREIGN KEY(tenant_id,case_id,speech_finding_id) REFERENCES speech_findings(tenant_id,case_id,id);
CREATE UNIQUE INDEX work_link_speech_identity ON case_work_links(tenant_id,case_id,item_id,speech_finding_id,relation)
 WHERE speech_finding_id IS NOT NULL;
