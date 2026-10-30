-- Application access additionally requires the injected sharing gate and current session.
CREATE FUNCTION portal_evidence_upload_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g portal_evidence_requests%ROWTYPE; u upload_reservations%ROWTYPE; p portal_evidence_publications%ROWTYPE; r portal_evidence_responses%ROWTYPE;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO g FROM portal_evidence_requests WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.request_id;
 SELECT * INTO u FROM upload_reservations WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.upload_id;
 SELECT * INTO p FROM portal_evidence_publications WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO r FROM portal_evidence_responses WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id AND publication_id=NEW.publication_id ORDER BY sequence DESC LIMIT 1;
 IF g.id IS NULL OR u.id IS NULL OR p.id IS NULL OR r.id IS NULL OR NEW.publication_id<>p.id OR p.action<>'published' OR NEW.response_id<>r.id OR r.state<>'submitted' OR
  u.created_by<>g.recipient_id OR r.actor_id<>g.recipient_id OR u.status<>'open' OR u.authority_version<>g.authority_version OR
  g.expires_at<=clock_timestamp() OR u.expires_at<=clock_timestamp() OR u.expires_at>g.expires_at OR u.expires_at>u.created_at+interval '24 hours 1 second' OR
  NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=g.tenant_id AND user_id=g.recipient_id AND role='client') OR
  NOT EXISTS(SELECT 1 FROM cases WHERE tenant_id=g.tenant_id AND id=g.case_id AND authority_version=g.authority_version AND status='Active' AND lifecycle_state IN ('Active','Review')) OR
  NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=g.tenant_id AND m.user_id=p.actor_id AND cm.case_id=g.case_id AND m.role='reviewer') THEN
  RAISE EXCEPTION 'Upload must bind the current published request, recipient response and approved authority' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_evidence_upload_guard BEFORE INSERT ON portal_evidence_uploads FOR EACH ROW EXECUTE FUNCTION portal_evidence_upload_guard();
CREATE INDEX portal_evidence_upload_request ON portal_evidence_uploads(tenant_id,case_id,request_id,publication_id);
