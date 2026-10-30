-- No historical report or decision bytes are rewritten. Withdrawal is terminal.
CREATE TABLE tika_claim_withdrawals (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,job_id uuid NOT NULL,citation_id uuid NOT NULL,claim_id uuid NOT NULL,
 id uuid NOT NULL,record jsonb NOT NULL CHECK(octet_length(record::text)<=16384),
 digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),actor_id uuid NOT NULL REFERENCES users(id),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,case_id,job_id,citation_id,claim_id),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id,citation_id,claim_id) REFERENCES tika_claims(tenant_id,case_id,job_id,citation_id,id)
);
CREATE TRIGGER tika_withdrawals_immutable BEFORE UPDATE OR DELETE ON tika_claim_withdrawals FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON tika_claim_withdrawals TO inveos_app;
CREATE FUNCTION validate_tika_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_hash text; decision_hash text;
BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 SELECT digest::text INTO STRICT claim_hash FROM tika_claims WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND job_id=NEW.job_id AND citation_id=NEW.citation_id AND id=NEW.claim_id;
 SELECT digest::text INTO decision_hash FROM tika_claim_decisions WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND job_id=NEW.job_id AND citation_id=NEW.citation_id AND claim_id=NEW.claim_id;
 IF NEW.record->>'id' IS DISTINCT FROM NEW.id::text OR NEW.record->>'claimId' IS DISTINCT FROM NEW.claim_id::text
 OR NEW.record->>'claimDigest' IS DISTINCT FROM btrim(claim_hash) OR NEW.record->>'decisionDigest' IS DISTINCT FROM btrim(decision_hash)
 OR NEW.record->>'actorId' IS DISTINCT FROM NEW.actor_id::text OR NEW.record->>'digest' IS DISTINCT FROM btrim(NEW.digest)
 OR coalesce(length(btrim(NEW.record->>'reason')),0) NOT BETWEEN 10 AND 3000
 OR NOT EXISTS(SELECT 1 FROM case_memberships cm JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id WHERE cm.tenant_id=NEW.tenant_id AND cm.case_id=NEW.case_id AND cm.user_id=NEW.actor_id AND m.role<>'client')
 THEN RAISE EXCEPTION 'Invalid Tika withdrawal identity or current actor'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tika_withdrawal_guard BEFORE INSERT ON tika_claim_withdrawals FOR EACH ROW EXECUTE FUNCTION validate_tika_withdrawal();
CREATE FUNCTION reject_withdrawn_tika_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM cases WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM tika_claim_withdrawals WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND job_id=NEW.job_id AND citation_id=NEW.citation_id AND claim_id=NEW.claim_id)
 THEN RAISE EXCEPTION 'Withdrawn Tika interpretation cannot receive a decision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tika_decision_withdrawal_guard BEFORE INSERT ON tika_claim_decisions FOR EACH ROW EXECUTE FUNCTION reject_withdrawn_tika_decision();
