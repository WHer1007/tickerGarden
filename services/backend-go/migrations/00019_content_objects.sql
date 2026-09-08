-- +goose Up
CREATE TABLE tickergarden.content_quota (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0),
 max_bytes bigint NOT NULL DEFAULT 1073741824 CHECK(max_bytes>0),
 window_start timestamptz NOT NULL DEFAULT date_trunc('hour',clock_timestamp()),
 window_objects integer NOT NULL DEFAULT 0 CHECK(window_objects>=0),
 max_hourly_objects integer NOT NULL DEFAULT 2000 CHECK(max_hourly_objects>0)
);
INSERT INTO tickergarden.content_quota(id) VALUES(true);
CREATE TABLE tickergarden.content_objects (
 key text PRIMARY KEY CHECK(key ~ '^[a-f0-9]{64}\.(json|png|jpg|webp)$'),
 payload bytea NOT NULL CHECK(octet_length(payload)>0 AND octet_length(payload)<=2097152),
 width integer NOT NULL CHECK(width>=0 AND width<=4096),
 height integer NOT NULL CHECK(height>=0 AND height<=4096),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(split_part(key,'.',1)=encode(sha256(payload),'hex')),
 CHECK((key LIKE '%.json' AND width=0 AND height=0) OR (key NOT LIKE '%.json' AND width>0 AND height>0))
);
-- +goose StatementBegin
CREATE FUNCTION tickergarden.content_charge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tickergarden AS $$
DECLARE n integer; at_hour timestamptz:=date_trunc('hour',clock_timestamp());
BEGIN
 UPDATE tickergarden.content_quota SET used_bytes=used_bytes+octet_length(NEW.payload),
 window_objects=CASE WHEN window_start=at_hour THEN window_objects+1 ELSE 1 END, window_start=at_hour
 WHERE id AND used_bytes+octet_length(NEW.payload)<=max_bytes
 AND (window_start<>at_hour OR window_objects<max_hourly_objects);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'content quota exhausted' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER content_charge AFTER INSERT ON tickergarden.content_objects FOR EACH ROW EXECUTE FUNCTION tickergarden.content_charge();
CREATE TRIGGER content_immutable BEFORE UPDATE OR DELETE ON tickergarden.content_objects FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
-- +goose Down
DROP TABLE tickergarden.content_objects;
DROP FUNCTION tickergarden.content_charge();
DROP TABLE tickergarden.content_quota;
