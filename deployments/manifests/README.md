# V2 deployment manifests

Production candidates must use the suffix `*.production.json`. Every such file
is scanned fail-closed for null/empty values, synthetic addresses or hashes,
draft/example tags, and copied reference fixtures before any RPC write.

Do not add a production manifest until V2-E-104-A freezes the complete schema.
The absence of a manifest is not readiness evidence. The central state is
`IMPLEMENTATION_ALLOWED`, but deployment remains fail-closed until every
deployment gate and the final manifest are complete.
