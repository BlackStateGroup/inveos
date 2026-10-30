CREATE FUNCTION portal_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g portal_evidence_requests%ROWTYPE; d portal_evidence_drafts%ROWTYPE; p portal_evidence_publications%ROWTYPE; n integer;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT * INTO g FROM portal_evidence_requests WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.request_id;
 SELECT * INTO d FROM portal_evidence_drafts WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO p FROM portal_evidence_publications WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id ORDER BY sequence DESC LIMIT 1;
 IF TG_TABLE_NAME='portal_evidence_drafts' THEN
  IF NEW.version<>COALESCE(d.version,0)+1 OR p.action='revoked' THEN RAISE EXCEPTION 'Sequential request drafts required; revocation is terminal' USING ERRCODE='55000'; END IF;
 ELSIF TG_TABLE_NAME='portal_evidence_publications' THEN
  IF NEW.sequence<>COALESCE(p.sequence,0)+1 OR p.action='revoked' OR (NEW.sequence=200 AND NEW.action<>'revoked') THEN RAISE EXCEPTION 'Publication sequence changed or request revoked' USING ERRCODE='55000'; END IF;
  IF NEW.action='published' AND (NEW.version<>d.version OR NEW.sha256<>d.sha256 OR
   EXISTS(SELECT 1 FROM portal_evidence_drafts WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id AND actor_id=NEW.actor_id) OR
   NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.actor_id AND cm.case_id=NEW.case_id AND m.role='reviewer')) THEN
   RAISE EXCEPTION 'Independent current case reviewer must publish the exact current draft' USING ERRCODE='55000'; END IF;
 ELSE
  SELECT COALESCE(max(sequence),0) INTO n FROM portal_evidence_responses WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND request_id=NEW.request_id AND publication_id=NEW.publication_id;
  IF NEW.sequence<>n+1 OR NEW.actor_id<>g.recipient_id OR NEW.publication_id IS DISTINCT FROM p.id OR p.action<>'published' OR NEW.publication_sha256<>p.sha256 OR g.expires_at<=clock_timestamp() OR
   NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=g.tenant_id AND user_id=g.recipient_id AND role='client') OR
   NOT EXISTS(SELECT 1 FROM cases WHERE tenant_id=g.tenant_id AND id=g.case_id AND authority_version=g.authority_version AND status='Active' AND lifecycle_state IN ('Active','Review')) OR
   NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=g.tenant_id AND m.user_id=p.actor_id AND cm.case_id=g.case_id AND m.role='reviewer') THEN
   RAISE EXCEPTION 'Response must bind current recipient access and exact publication' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_evidence_draft_guard BEFORE INSERT ON portal_evidence_drafts FOR EACH ROW EXECUTE FUNCTION portal_evidence_guard();
CREATE TRIGGER portal_evidence_publication_guard BEFORE INSERT ON portal_evidence_publications FOR EACH ROW EXECUTE FUNCTION portal_evidence_guard();
CREATE TRIGGER portal_evidence_response_guard BEFORE INSERT ON portal_evidence_responses FOR EACH ROW EXECUTE FUNCTION portal_evidence_guard();
CREATE FUNCTION portal_evidence_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u upload_reservations%ROWTYPE; e evidence%ROWTYPE;
BEGIN
 SELECT * INTO u FROM upload_reservations WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.upload_id;
 SELECT * INTO e FROM evidence WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND id=NEW.evidence_id;
 IF u.status<>'completed' OR u.evidence_id IS DISTINCT FROM e.id OR e.id IS NULL OR e.original_kind<>'opaque_binary' OR e.status<>'Quarantined' OR
  e.digest<>NEW.sha256 OR e.byte_length<>NEW.byte_length OR e.received_time<>NEW.received_at OR e.created_by<>u.created_by OR
  e.authority_version<>u.authority_version OR e.filename<>u.metadata->>'filename' OR e.source_time<>u.metadata->>'sourceTime' OR e.method<>u.metadata->>'method' OR e.digest<>u.metadata->>'expectedSha256' OR e.byte_length<>u.byte_length THEN
  RAISE EXCEPTION 'Portal receipt must match the completed reservation and immutable quarantined original' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER portal_evidence_receipt_guard BEFORE INSERT ON portal_evidence_receipts FOR EACH ROW EXECUTE FUNCTION portal_evidence_receipt_guard();
