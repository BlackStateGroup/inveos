CREATE FUNCTION portal_feedback_release_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grant_row report_disclosures%ROWTYPE; delivery_digest text; copy_id uuid; kind text;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO grant_row FROM report_disclosures WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.disclosure_id;
 SELECT COALESCE(er.docx_digest,pr.pdf_digest,p.package_digest,d.digest),COALESCE(ed.rendition_id,dr.rendition_id),
 CASE WHEN ed.rendition_id IS NOT NULL THEN 'report_docx' WHEN dr.rendition_id IS NOT NULL THEN 'report_pdf' WHEN p.package_digest IS NOT NULL THEN 'document_package' ELSE 'report_json' END
 INTO delivery_digest,copy_id,kind FROM report_disclosures d
 LEFT JOIN report_disclosure_packages p ON p.tenant_id=d.tenant_id AND p.disclosure_id=d.id
 LEFT JOIN report_disclosure_renditions dr ON dr.tenant_id=d.tenant_id AND dr.disclosure_id=d.id
 LEFT JOIN report_renditions pr ON pr.tenant_id=dr.tenant_id AND pr.case_id=dr.case_id AND pr.id=dr.rendition_id
 LEFT JOIN report_disclosure_editable_renditions ed ON ed.tenant_id=d.tenant_id AND ed.disclosure_id=d.id
 LEFT JOIN report_editable_renditions er ON er.tenant_id=ed.tenant_id AND er.case_id=ed.case_id AND er.id=ed.rendition_id
 WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.disclosure_id;
 IF NEW.version<>1 OR NEW.report_digest IS DISTINCT FROM grant_row.digest OR NEW.delivery_digest::text IS DISTINCT FROM delivery_digest OR
 NEW.deliverable IS DISTINCT FROM kind OR NEW.rendition_id IS DISTINCT FROM copy_id THEN
  RAISE EXCEPTION 'Feedback must bind the exact immutable released report/copy receipt' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_feedback_release_receipt BEFORE INSERT ON portal_feedback_requests FOR EACH ROW EXECUTE FUNCTION portal_feedback_release_receipt();
CREATE FUNCTION portal_feedback_request_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE head portal_feedback_requests%ROWTYPE; publication portal_feedback_publications%ROWTYPE; response portal_feedback_response_revisions%ROWTYPE;
BEGIN
 SELECT * INTO head FROM portal_feedback_requests WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.request_id;
 IF head.version<NEW.version THEN RAISE EXCEPTION 'Feedback head must include its saved revision' USING ERRCODE='55000'; END IF;
 IF NEW.action='resolved' THEN
  SELECT * INTO publication FROM portal_feedback_publications WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO response FROM portal_feedback_response_revisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id AND version=publication.response_version;
  IF publication.id IS DISTINCT FROM NEW.response_publication_id OR publication.action IS DISTINCT FROM 'published' OR response.request_content_version IS DISTINCT FROM NEW.content_version THEN
   RAISE EXCEPTION 'Resolution must name the current published response to the current request text' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER portal_feedback_request_complete AFTER INSERT ON portal_feedback_request_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal_feedback_request_complete();
