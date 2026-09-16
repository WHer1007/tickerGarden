# VPS ingress hardening

No new paid services are required. PostgreSQL still has public TCP listeners because Vercel uses dynamic egress. External application connections require all of TLS, the correct environment's client certificate (CN equals database role), and SCRAM password. This prevents unauthenticated database use, but does not hide ports or provide volumetric DDoS protection.

## Rollout order

1. Run `provision-db-client-certs.sh test` as root on the VPS. Private material stays under `/etc/tickergarden/security/test` (0700 directory, 0600 keys). Production has a distinct CA.
2. Configure `TG_DB_CLIENT_CERT_PEM` and `TG_DB_CLIENT_KEY_PEM` in each corresponding Vercel environment/project, alongside the existing server `TG_DB_CA_PEM`. Do not put TLS parameters into the database URL when using these PEM variables.
3. Deploy and verify test read-api, pipeline and content from `test`, all in `sin1`. Check actual database TLS client identity. Only then run `enforce-db-client-certs.py test --apply`.
4. Verify valid clients succeed and clients missing a certificate, using another environment's certificate, or using plaintext fail. Check worker and queue health. Promote the accepted tree to `master`; repeat for production, switching all client deployments before enforcing the production HBA rule.
5. Cloudflare: proxy `queue`, `storage`, `queue-test`, `storage-test` to the VPS; use Full (strict), bypass cache for all four hostnames, and avoid interactive challenges for machine endpoints. Verify real signed S3 access and queue requests, not only DNS.
6. Switch test environment URLs away from sslip.io, verify, then reload the checked-in Caddyfile (which omits those old names).
7. Install `edge-firewall.sh` and the systemd unit, run `prepare` first, then `cloudflare-only` after proxy acceptance. It protects both Docker forwarding and host INPUT, including IPv6. Existing established connections remain alive. Port 22 remains key-only and separately governed by UFW/Fail2ban.

Caddy limits request bodies and read timeouts. Queue health probes share one DB check per 5 seconds; queue bodies are bounded during streaming. DB new connections are limited per source (20/s, burst 80; 80 concurrent) rather than relying on UFW alone. Shared Vercel egress must be watched for legitimate bursts; adjust only from measured demand.

## Recovery and maintenance

- Before changing HBA, the script stores the original at `/etc/tickergarden/security/<environment>/pg_hba.before.conf`. Restore that file to the container's PGDATA/pg_hba.conf, set owner postgres, and call `SELECT pg_reload_conf()` through local `docker exec ... psql` if a verified client cannot connect. Local socket admin access remains available.
- To roll back network rules, delete the `-i <public interface> -j TG-GUARD` jumps from INPUT and DOCKER-USER in both iptables and ip6tables; disable the security service. Do not flush unrelated host rules.
- Rotate client certificates before their 365-day expiry. Distribute replacement credentials and verify deployments before revoking/removing an old CA. The provision script preserves existing files; renewal is a separate deliberate operation.
- Retain least-privilege database roles and connection budgets. Private CA keys remain only on the VPS; this is not a backup plan. Automatic offsite backup remains deferred by the owner.
- Cloudflare CIDR lists come from its official endpoint. Keep a last-known valid copy for boot recovery and refresh during reviewed operations. Cloudflare protects the proxied web services, not arbitrary traffic sent to the known VPS IP.
