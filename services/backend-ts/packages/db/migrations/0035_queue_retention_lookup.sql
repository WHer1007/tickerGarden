-- Keep dead deliveries in the protection check. The active-delivery index
-- excludes dead rows and cannot serve the retention predicate state <> 'sent'.
CREATE INDEX outbox_retention_unsent ON {{schema}}.outbox_messages(operation_id) WHERE state<>'sent';
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0035_queue_retention_lookup');
