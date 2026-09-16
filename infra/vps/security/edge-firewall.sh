#!/usr/bin/env bash
# Apply on the VPS only after all four HTTPS endpoints work through Cloudflare.
# Database ports remain public for authenticated Vercel clients without static egress.
set -euo pipefail
mode=${1:?usage: edge-firewall.sh prepare|cloudflare-only}
[[ $mode == prepare || $mode == cloudflare-only ]] || exit 2
interface=$(ip route show default | awk '/default/{print $5;exit}')
[[ -n $interface ]] || exit 1
base=/etc/tickergarden/security
install -d -m 700 "$base"
if [[ $mode == cloudflare-only && ( ! -s $base/cloudflare-v4 || ! -s $base/cloudflare-v6 ) ]]; then
  curl --fail --silent --show-error --max-time 20 https://www.cloudflare.com/ips-v4 > "$base/cloudflare-v4.next"
  curl --fail --silent --show-error --max-time 20 https://www.cloudflare.com/ips-v6 > "$base/cloudflare-v6.next"
  python3 - "$base" <<'PY'
import pathlib,sys,ipaddress
base=pathlib.Path(sys.argv[1])
for version in [4,6]:
 p=base/f'cloudflare-v{version}.next';rows=p.read_text().splitlines()
 assert len(rows)>=5 and all(ipaddress.ip_network(x).version==version for x in rows)
 p.replace(base/f'cloudflare-v{version}')
PY
fi
for version in 4 6; do
  tool=iptables;[[ $version == 6 ]] && tool=ip6tables
  # First build an unreferenced chain; existing traffic rules stay intact on error.
  next=TG-G-$$-$version
  $tool -w -N "$next"
  $tool -w -A "$next" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  $tool -w -A "$next" -p tcp -m multiport --dports 5432,5433,5434 --syn -m connlimit --connlimit-above 80 --connlimit-mask $([[ $version == 4 ]] && echo 32 || echo 128) -j DROP
  $tool -w -A "$next" -p tcp -m multiport --dports 5432,5433,5434 --syn -m hashlimit --hashlimit-above 20/second --hashlimit-burst 80 --hashlimit-mode srcip --hashlimit-name tg_db_new --hashlimit-htable-max 8192 -j DROP
  if [[ $mode == cloudflare-only ]]; then
    while read -r cidr; do
      [[ -z $cidr ]] || $tool -w -A "$next" -p tcp -s "$cidr" -m multiport --dports 80,443 -j RETURN
    done < "$base/cloudflare-v$version"
    $tool -w -A "$next" -p tcp -m multiport --dports 80,443 -j DROP
  fi
  $tool -w -A "$next" -j RETURN
  $tool -w -N TG-GUARD 2>/dev/null || true
  # One insertion activates the prepared rules; prune the previous chain afterward.
  old=$($tool -w -S TG-GUARD | awk '/^-A/{print $NF}')
  $tool -w -I TG-GUARD 1 -j "$next"
  $tool -w -N DOCKER-USER 2>/dev/null || true
  for parent in INPUT DOCKER-USER; do
    $tool -w -C "$parent" -i "$interface" -j TG-GUARD 2>/dev/null || $tool -w -I "$parent" 1 -i "$interface" -j TG-GUARD
  done
  # TG-GUARD owns no unrelated rules. Keep a single jump to this ruleset.
  while [[ $($tool -w -S TG-GUARD | grep -c '^-A') -gt 1 ]]; do $tool -w -D TG-GUARD 2; done
  for chain in $old; do
    if [[ $chain == TG-G-* && $chain != "$next" ]]; then $tool -w -F "$chain"; $tool -w -X "$chain"; fi
  done
  $tool -w -S TG-GUARD
 done
printf '%s\n' "$mode" > "$base/firewall-mode"
