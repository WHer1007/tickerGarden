-- +goose Up
-- Old authorship is unknown. Do not attribute old candidates to the migrator.
ALTER TABLE tickergarden.treasury_candidates ADD COLUMN created_by text;
-- +goose StatementBegin
CREATE FUNCTION tickergarden.treasury_candidate_author() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.created_by:=session_user; RETURN NEW; END $$;
-- +goose StatementEnd
CREATE TRIGGER treasury_candidate_author BEFORE INSERT ON tickergarden.treasury_candidates FOR EACH ROW EXECUTE FUNCTION tickergarden.treasury_candidate_author();
CREATE TABLE tickergarden.treasury_reviews (
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id text PRIMARY KEY CHECK(id ~ '^0x[0-9a-f]{64}$'),
 operation_id text NOT NULL UNIQUE CHECK(operation_id ~ '^0x[0-9a-f]{64}$'),
 candidate_id text NOT NULL REFERENCES tickergarden.treasury_candidates(id),
 reviewer text NOT NULL DEFAULT session_user,
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 payload bytea NOT NULL CHECK(octet_length(payload)<=2097152),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX treasury_reviews_candidate ON tickergarden.treasury_reviews(candidate_id,sequence DESC);
-- +goose StatementBegin
CREATE FUNCTION tickergarden.treasury_review_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tickergarden AS $$
DECLARE author text;
BEGIN
 SELECT created_by INTO author FROM tickergarden.treasury_candidates WHERE id=NEW.candidate_id;
 IF author IS NULL OR author=session_user THEN RAISE EXCEPTION 'Treasury review requires known independent author and reviewer'; END IF;
 NEW.reviewer:=session_user;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER treasury_review_identity BEFORE INSERT ON tickergarden.treasury_reviews FOR EACH ROW EXECUTE FUNCTION tickergarden.treasury_review_identity();
CREATE TRIGGER treasury_reviews_immutable BEFORE UPDATE OR DELETE ON tickergarden.treasury_reviews FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
-- +goose Down
DROP TABLE tickergarden.treasury_reviews;
DROP FUNCTION tickergarden.treasury_review_identity();
DROP TRIGGER treasury_candidate_author ON tickergarden.treasury_candidates;
DROP FUNCTION tickergarden.treasury_candidate_author();
ALTER TABLE tickergarden.treasury_candidates DROP COLUMN created_by;
