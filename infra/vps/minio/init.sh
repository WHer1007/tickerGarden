#!/bin/sh
set -eu
alias_name="tg-${TG_ENVIRONMENT}"
bucket="${TG_CONTENT_BUCKET}"
mc alias set "$alias_name" http://"${MINIO_HOST}":9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "$alias_name/$bucket"
mc version enable "$alias_name/$bucket"
mc anonymous set none "$alias_name/$bucket"
cat >/tmp/app-policy.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:AbortMultipartUpload","s3:ListBucketMultipartUploads","s3:ListMultipartUploadParts"],"Resource":["arn:aws:s3:::$bucket","arn:aws:s3:::$bucket/*"]}]}
JSON
mc admin user add "$alias_name" "$TG_CONTENT_ACCESS_KEY_ID" "$TG_CONTENT_SECRET_ACCESS_KEY" || true
mc admin policy create "$alias_name" tickergarden-content /tmp/app-policy.json
mc admin policy attach "$alias_name" tickergarden-content --user "$TG_CONTENT_ACCESS_KEY_ID"
mc stat "$alias_name/$bucket"
