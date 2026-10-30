-- New immutable profile identities; historical profile bytes/digests remain unchanged.
ALTER TABLE integrity_jobs DROP CONSTRAINT integrity_jobs_kind_check;
ALTER TABLE integrity_jobs ADD CONSTRAINT integrity_jobs_kind_check CHECK
 (kind IN ('original_sha256_v1','utf8_line_index_v1','native_pdf_lab_v1','pdf_raster_lab_v1','pdf_raster_lab_v2','tesseract_scan_lab_v1','tesseract_scan_lab_v2'));
ALTER TABLE document_derivatives DROP CONSTRAINT document_derivatives_kind_check;
ALTER TABLE document_derivatives ADD CONSTRAINT document_derivatives_kind_check CHECK
 (kind IN ('native_pdf_lab_v1','tesseract_scan_lab_v1','tesseract_scan_lab_v2'));
ALTER TABLE raster_derivatives DROP CONSTRAINT raster_derivatives_kind_check;
ALTER TABLE raster_derivatives ADD CONSTRAINT raster_derivatives_kind_check CHECK (kind IN ('pdf_raster_lab_v1','pdf_raster_lab_v2'));
CREATE OR REPLACE FUNCTION require_document_derivative_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM integrity_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.case_id=NEW.case_id
   AND j.id=NEW.id AND j.kind IN ('native_pdf_lab_v1','tesseract_scan_lab_v1','tesseract_scan_lab_v2') AND j.status='succeeded') AND NOT EXISTS (
   SELECT 1 FROM document_derivatives d WHERE d.tenant_id=NEW.tenant_id AND d.case_id=NEW.case_id AND d.job_id=NEW.id)
 THEN RAISE EXCEPTION 'Successful document job requires immutable derivative' USING ERRCODE='55000'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION require_raster_derivative_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM integrity_jobs j WHERE j.tenant_id=NEW.tenant_id AND j.case_id=NEW.case_id
   AND j.id=NEW.id AND j.kind IN ('pdf_raster_lab_v1','pdf_raster_lab_v2') AND j.status='succeeded') AND NOT EXISTS (
   SELECT 1 FROM raster_derivatives d WHERE d.tenant_id=NEW.tenant_id AND d.case_id=NEW.case_id AND d.job_id=NEW.id)
 THEN RAISE EXCEPTION 'Successful raster job requires immutable derivative' USING ERRCODE='55000'; END IF;
 RETURN NULL;
END $$;
