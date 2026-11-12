#!/usr/bin/env bash
# Apply before Docker/network startup as well as during live ingress hardening.
# Only the recorded public interface is restricted; SSH tunnels and private peers remain usable.
set -euo pipefail
base=/etc/tickergarden/security
interface=$(cat "$base/public-interface")
[[ $interface =~ ^[a-zA-Z0-9_.:-]+$ ]] || exit 1
rule=$(mktemp)
trap 'rm -f "$rule"' EXIT
if nft list table inet tg_database_ingress >/dev/null 2>&1; then
  printf '%s\n' 'delete table inet tg_database_ingress' > "$rule"
fi
cat >> "$rule" <<EOF
table inet tg_database_ingress {
  chain ingress {
    type filter hook prerouting priority -310; policy accept;
    iifname "$interface" tcp dport { 5432, 5433, 5434 } counter drop
  }
}
EOF
nft -c -f "$rule"
nft -f "$rule"
