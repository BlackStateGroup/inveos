ALTER TABLE speech_segment_reviews ADD UNIQUE(tenant_id,case_id,job_id,segment_index,version,digest);
CREATE TABLE speech_claims (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 job_id uuid NOT NULL,segment_index integer NOT NULL CHECK(segment_index BETWEEN 0 AND 127),segment_version integer NOT NULL CHECK(segment_version BETWEEN 0 AND 100),
 correspondence_digest char(64) NOT NULL CHECK(correspondence_digest ~ '^[a-f0-9]{64}$'),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL,digest char(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 proposed_by uuid NOT NULL REFERENCES users(id),proposed_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,job_id,segment_index,segment_version,correspondence_digest) REFERENCES speech_segment_reviews(tenant_id,case_id,job_id,segment_index,version,digest)
);
CREATE TABLE speech_claim_reviews (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,claim_id uuid NOT NULL,
 claim_digest char(64) NOT NULL CHECK(claim_digest ~ '^[a-f0-9]{64}$'),
 accepted boolean NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 3000),
 reviewer_id uuid NOT NULL REFERENCES users(id),reviewer_name text NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,claim_id),UNIQUE(tenant_id,case_id,claim_id,id),
 FOREIGN KEY(tenant_id,case_id,claim_id) REFERENCES speech_claims(tenant_id,case_id,id)
);
CREATE TABLE speech_findings (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,claim_id uuid NOT NULL,review_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,case_id,id),UNIQUE(tenant_id,case_id,claim_id),
 FOREIGN KEY(tenant_id,case_id,claim_id,review_id) REFERENCES speech_claim_reviews(tenant_id,case_id,claim_id,id)
);
CREATE TRIGGER speech_claim_immutable BEFORE UPDATE OR DELETE ON speech_claims FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER speech_claim_review_immutable BEFORE UPDATE OR DELETE ON speech_claim_reviews FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER speech_finding_immutable BEFORE UPDATE OR DELETE ON speech_findings FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON speech_claims,speech_claim_reviews,speech_findings TO inveos_app;
CREATE TABLE speech_claim_withdrawals (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,claim_id uuid NOT NULL,id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 3000),recorded_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,case_id,claim_id),UNIQUE(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,claim_id) REFERENCES speech_claims(tenant_id,case_id,id)
);
CREATE TRIGGER speech_claim_withdrawal_immutable BEFORE UPDATE OR DELETE ON speech_claim_withdrawals FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON speech_claim_withdrawals TO inveos_app;
