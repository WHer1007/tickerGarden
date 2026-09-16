# Web and upload security

## Metadata uploads

The content-worker requires an EIP-191 wallet signature before POST /launch-metadata.
The front end requests /launch-metadata/challenge and independently reconstructs the
message before signing. It binds the web origin, chain ID, wallet, SHA-256 of the
exact request body, random 256-bit nonce, and a five-minute expiry. This signature
is not a transaction or token approval and has no gas cost. EOA signatures are
supported; contract-wallet signatures are rejected (no permissive fallback).

Migration 00078 stores single-use nonces and rate counters in PostgreSQL. Apply it
before starting the updated content-worker. Readiness checks require the new tables.
Only the authenticated wrapper is mounted by RunContent. GET metadata stays public.

Limits, enforced atomically across instances and restarts:

- Challenges: 10 per IP per minute, 120 globally per minute.
- Upload attempts with a valid signature: 5 per wallet per hour, 20 per day;
  30 per IP per hour, 100 per day; 50 globally per hour, 200 per day.
- Four concurrent authorization/upload requests per process, plus the publisher's
  existing concurrency and persistent storage quota.
- Each authorization is consumed before publication. Failed publication needs a
  fresh authorization. Old/replayed signatures cannot trigger a second publication.

IP keys use hashed socket-peer addresses; untrusted X-Forwarded-For is ignored.
Behind a reverse proxy, clients conservatively share its IP limit. Keep separate
edge rate limits in place; do not enable trust of arbitrary forwarded headers.
Origin validation is additional browser protection, never authentication.

## Page response headers

Vite dev/preview and `npm --prefix apps/web start` share security/headers.mjs.
`npm --prefix apps/web run build` emits dist/_headers for hosts supporting that file.
The production static server reads those exact build headers, keeping the CSP
allowlist aligned with VITE endpoint configuration from the root environment file.

Run `npm --prefix apps/web start` behind an HTTPS reverse proxy, or use a static host
that applies dist/_headers. Default listen: 127.0.0.1:4173, configurable with HOST/PORT.
A host that ignores _headers must explicitly apply the same response headers.
Do not serve production with the Vite development server. Build using the intended
profile; a test-profile build intentionally includes its local test endpoints.

Policies include CSP (self-only scripts, no objects, no frames/ancestors, restricted
connections), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy and
production HSTS. Inline styles remain allowed for existing dynamic layout; inline
scripts and eval are not allowed. HTTPS images remain allowed for public logos.
HSTS requires HTTPS to take effect. No private credentials are emitted in _headers.

Verification covers invalid content/chain/origin/signature, expiry, concurrent
replay, persistent wallet limits, unsigned uploads, authenticated requests, browser
framing rejection and CSP compatibility. Tests use fake publishers; they neither
spend IPFS quota nor broadcast wallet transactions.
