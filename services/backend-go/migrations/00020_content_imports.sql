-- +goose Up
CREATE TABLE tickergarden.content_imports (
 digest text PRIMARY KEY CHECK(digest ~ '^[0-9a-f]{64}$'),
 report bytea NOT NULL CHECK(octet_length(report)<=1048576 AND encode(sha256(report),'hex')=digest),
 actor text NOT NULL DEFAULT session_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- +goose StatementBegin
CREATE FUNCTION tickergarden.content_import_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.actor:=session_user; RETURN NEW; END $$;
-- +goose StatementEnd
CREATE TRIGGER content_import_actor BEFORE INSERT ON tickergarden.content_imports FOR EACH ROW EXECUTE FUNCTION tickergarden.content_import_actor();
CREATE TRIGGER content_import_immutable BEFORE UPDATE OR DELETE ON tickergarden.content_imports FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
-- +goose Down
DROP TABLE tickergarden.content_imports;
DROP FUNCTION tickergarden.content_import_actor();
