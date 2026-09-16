#!/usr/bin/env bash
# Run as root on the VPS. Never copy private keys into source control or logs.
set -euo pipefail
stage=${1:?usage: provision-db-client-certs.sh test|production}
[[ $stage == test || $stage == production ]] || exit 2
base=/etc/tickergarden/security/$stage
install -d -m 700 "$base"
umask 077
if [[ ! -s $base/ca.crt ]]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 -subj "/CN=TickerGarden $stage database clients" -keyout "$base/ca.key" -out "$base/ca.crt" 2>/dev/null
fi
for role in tg_read_api tg_pipeline tg_content; do
  if [[ ! -s $base/$role.crt ]]; then
    openssl req -new -newkey rsa:2048 -nodes -subj "/CN=$role" -keyout "$base/$role.key" -out "$base/$role.csr" 2>/dev/null
    printf 'extendedKeyUsage=clientAuth\nkeyUsage=digitalSignature,keyEncipherment\n' > "$base/$role.ext"
    openssl x509 -req -in "$base/$role.csr" -CA "$base/ca.crt" -CAkey "$base/ca.key" -CAcreateserial -days 365 -sha256 -extfile "$base/$role.ext" -out "$base/$role.crt" 2>/dev/null
  fi
  openssl verify -CAfile "$base/ca.crt" "$base/$role.crt"
done
