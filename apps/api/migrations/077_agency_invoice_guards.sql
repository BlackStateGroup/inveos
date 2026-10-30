ALTER TABLE agency_billing_declarations ADD CONSTRAINT agency_declaration_authority_fk
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version);
ALTER TABLE agency_invoice_revisions ADD CONSTRAINT agency_invoice_authority_fk
 FOREIGN KEY(tenant_id,case_id,authority_version) REFERENCES authority_records(tenant_id,case_id,version);

CREATE FUNCTION agency_invoice_line_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb; line jsonb;
BEGIN
 SELECT convert_from(snapshot_bytes,'UTF8')::jsonb INTO snapshot FROM agency_invoice_revisions
 WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND invoice_id=NEW.invoice_id AND version=NEW.invoice_version;
 line := snapshot->'lines'->(NEW.position-1);
 IF line IS NULL OR (line->>'position')::int IS DISTINCT FROM NEW.position OR line->>'kind' IS DISTINCT FROM NEW.kind OR
 line->>'sourceId' IS DISTINCT FROM NEW.source_id::text OR (line->>'sourceVersion')::int IS DISTINCT FROM NEW.source_version OR
 (line->>'netMinor')::bigint IS DISTINCT FROM NEW.net_minor OR (line->>'taxMinor')::bigint IS DISTINCT FROM NEW.tax_minor THEN
  RAISE EXCEPTION 'Invoice line must equal its frozen snapshot receipt' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_invoice_line_receipt BEFORE INSERT ON agency_invoice_lines FOR EACH ROW EXECUTE FUNCTION agency_invoice_line_receipt();

CREATE FUNCTION agency_invoice_revision_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb; declared agency_billing_declarations%ROWTYPE;
BEGIN
 snapshot := convert_from(NEW.snapshot_bytes,'UTF8')::jsonb;
 SELECT * INTO declared FROM agency_billing_declarations WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND currency=NEW.currency AND version=NEW.declaration_version;
 IF snapshot->>'format' IS DISTINCT FROM 'inveos_internal_invoice_v1' OR snapshot->>'tenantId' IS DISTINCT FROM NEW.tenant_id::text OR
 snapshot->>'caseId' IS DISTINCT FROM NEW.case_id::text OR snapshot->>'invoiceId' IS DISTINCT FROM NEW.invoice_id::text OR
 (snapshot->>'version')::int IS DISTINCT FROM NEW.version OR snapshot->>'action' IS DISTINCT FROM NEW.action OR
 snapshot->>'reference' IS DISTINCT FROM NEW.reference OR snapshot->>'reason' IS DISTINCT FROM NEW.reason OR
 snapshot->>'previousSha256' IS DISTINCT FROM NEW.previous_sha256::text OR
 (snapshot->>'authorityVersion')::int IS DISTINCT FROM NEW.authority_version OR
 snapshot->'preparedBy'->>'id' IS DISTINCT FROM NEW.actor_id::text OR
 (snapshot->>'frozenAt')::timestamptz IS DISTINCT FROM NEW.recorded_at OR
 snapshot->'declaration'->>'currency' IS DISTINCT FROM NEW.currency OR
 (snapshot->'declaration'->>'version')::int IS DISTINCT FROM NEW.declaration_version OR
 snapshot->'declaration'->>'recipientId' IS DISTINCT FROM NEW.recipient_id::text OR
 declared.recipient_id IS DISTINCT FROM NEW.recipient_id OR declared.authority_version IS DISTINCT FROM NEW.authority_version OR
 snapshot->'totals'->>'currency' IS DISTINCT FROM NEW.currency OR
 (snapshot->'totals'->>'netMinor')::bigint IS DISTINCT FROM NEW.net_minor OR
 (snapshot->'totals'->>'taxMinor')::bigint IS DISTINCT FROM NEW.tax_minor OR
 (snapshot->'totals'->>'totalMinor')::bigint IS DISTINCT FROM NEW.total_minor OR
 jsonb_array_length(snapshot->'lines') NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invoice snapshot identity and saved receipt must agree' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_invoice_revision_receipt BEFORE INSERT ON agency_invoice_revisions FOR EACH ROW EXECUTE FUNCTION agency_invoice_revision_receipt();

CREATE FUNCTION agency_invoice_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision agency_invoice_revisions%ROWTYPE; current_declaration agency_billing_declarations%ROWTYPE; current_case cases%ROWTYPE;
BEGIN
 SELECT * INTO current_case FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT r.* INTO revision FROM agency_invoices h JOIN agency_invoice_revisions r ON r.tenant_id=h.tenant_id AND r.case_id=h.case_id AND r.invoice_id=h.id AND r.version=h.version
 WHERE h.tenant_id=NEW.tenant_id AND h.case_id=NEW.case_id AND h.id=NEW.invoice_id;
 IF revision.version IS DISTINCT FROM NEW.version OR revision.sha256 IS DISTINCT FROM NEW.sha256 OR revision.action='withdrawn' OR
 NOT EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND cm.case_id=NEW.case_id AND m.user_id=NEW.actor_id AND m.role='reviewer') OR
 EXISTS(SELECT 1 FROM agency_invoice_revisions r WHERE r.tenant_id=NEW.tenant_id AND r.case_id=NEW.case_id AND r.invoice_id=NEW.invoice_id AND r.actor_id=NEW.actor_id) OR
 EXISTS(SELECT 1 FROM agency_invoice_lines l LEFT JOIN case_time_entries t ON t.tenant_id=l.tenant_id AND t.case_id=l.case_id AND t.id=l.time_id LEFT JOIN case_expenses e ON e.tenant_id=l.tenant_id AND e.case_id=l.case_id AND e.id=l.expense_id WHERE l.tenant_id=NEW.tenant_id AND l.case_id=NEW.case_id AND l.invoice_id=NEW.invoice_id AND l.invoice_version=NEW.version AND (t.created_by=NEW.actor_id OR e.created_by=NEW.actor_id)) THEN
  RAISE EXCEPTION 'Invoice review must independently name the current exact draft' USING ERRCODE='55000';
 END IF;
 IF NEW.accepted THEN
  SELECT * INTO current_declaration FROM agency_billing_declarations WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND currency=revision.currency ORDER BY version DESC LIMIT 1;
  IF current_declaration.version IS DISTINCT FROM revision.declaration_version OR current_declaration.action='withdrawn' OR current_case.authority_version IS DISTINCT FROM revision.authority_version OR current_case.status<>'Active' OR current_case.lifecycle_state NOT IN ('Active','Review') OR
  NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND user_id=revision.recipient_id AND role='client') OR
  EXISTS(SELECT 1 FROM agency_invoice_lines l LEFT JOIN case_time_entries t ON t.tenant_id=l.tenant_id AND t.case_id=l.case_id AND t.id=l.time_id LEFT JOIN case_expenses e ON e.tenant_id=l.tenant_id AND e.case_id=l.case_id AND e.id=l.expense_id WHERE l.tenant_id=NEW.tenant_id AND l.case_id=NEW.case_id AND l.invoice_id=NEW.invoice_id AND l.invoice_version=NEW.version AND ((l.kind='time' AND t.version<>l.source_version) OR (l.kind='expense' AND e.version<>l.source_version))) THEN
   RAISE EXCEPTION 'Invoice acceptance requires current declaration, authority, recipient and sources' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_invoice_review_guard BEFORE INSERT ON agency_invoice_reviews FOR EACH ROW EXECUTE FUNCTION agency_invoice_review_guard();
