-- Display-only correction. Holder eligibility, exclusions and reward balances are unchanged.
-- Deploy readers accepting CHAIN_TOTAL_SUPPLY_V1 before this migration and new writers.
UPDATE {{schema}}.confirmed_display_sections
SET payload=jsonb_set(jsonb_set(payload,'{holders,circulatingSupplyRaw}',payload#>'{holders,totalSupplyRaw}'),'{holders,basis}','"CHAIN_TOTAL_SUPPLY_V1"'::jsonb)
WHERE section='common' AND jsonb_typeof(payload->'holders')='object'
 AND payload#>>'{holders,totalSupplyRaw}' ~ '^(0|[1-9][0-9]*)$';
UPDATE {{schema}}.recent_markets
SET initial_detail=jsonb_set(jsonb_set(initial_detail,'{holders,circulatingSupplyRaw}',initial_detail#>'{holders,totalSupplyRaw}'),'{holders,basis}','"CHAIN_TOTAL_SUPPLY_V1"'::jsonb)
WHERE jsonb_typeof(initial_detail->'holders')='object'
 AND initial_detail#>>'{holders,totalSupplyRaw}' ~ '^(0|[1-9][0-9]*)$';
-- Expire responses carrying the previous definition, not source/audit records.
DELETE FROM {{schema}}.statistics_result_cache WHERE payload ? 'holders';
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0034_circulating_supply');
