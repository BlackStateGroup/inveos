CREATE TABLE work_comments (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, item_id uuid NOT NULL, id uuid NOT NULL,
 author_id uuid NOT NULL, author_name text NOT NULL, version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,case_id,item_id) REFERENCES case_work_items(tenant_id,case_id,id),
 FOREIGN KEY(tenant_id,author_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX work_comments_item ON work_comments(tenant_id,case_id,item_id,id);
CREATE TABLE work_comment_revisions (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, comment_id uuid NOT NULL, version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 body text NOT NULL CHECK(length(body)<=4000), mentions jsonb NOT NULL CHECK(jsonb_typeof(mentions)='array' AND jsonb_array_length(mentions)<=8),
 withdrawn boolean NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,comment_id,version),
 FOREIGN KEY(tenant_id,case_id,comment_id) REFERENCES work_comments(tenant_id,case_id,id),
 CHECK((withdrawn AND body='' AND mentions='[]'::jsonb) OR (NOT withdrawn AND length(btrim(body))>0))
);
CREATE TABLE work_mention_reads (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, user_id uuid NOT NULL, comment_id uuid NOT NULL, version integer NOT NULL,
 read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,case_id,user_id,comment_id,version),
 FOREIGN KEY(tenant_id,case_id,comment_id,version) REFERENCES work_comment_revisions(tenant_id,case_id,comment_id,version),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TRIGGER work_comment_no_delete BEFORE DELETE ON work_comments FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER work_comment_history_immutable BEFORE UPDATE OR DELETE ON work_comment_revisions FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER work_mention_reads_immutable BEFORE UPDATE OR DELETE ON work_mention_reads FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
GRANT SELECT,INSERT ON work_comments,work_comment_revisions,work_mention_reads TO inveos_app;
GRANT UPDATE(version) ON work_comments TO inveos_app;
