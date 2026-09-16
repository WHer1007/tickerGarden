-- +goose Up
CREATE TABLE tickergarden.content_upload_challenges (
 nonce text PRIMARY KEY, account text NOT NULL, digest text NOT NULL,
 expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
);
CREATE INDEX content_upload_challenges_expiry ON tickergarden.content_upload_challenges(expires_at);
CREATE TABLE tickergarden.content_upload_limits (
 key text PRIMARY KEY, bucket bigint NOT NULL, count integer NOT NULL, expires_at timestamptz NOT NULL
);
-- +goose Down
DROP TABLE tickergarden.content_upload_limits;
DROP TABLE tickergarden.content_upload_challenges;
