ALTER TABLE {{schema}}.queue_generations ADD COLUMN execution_mode text NOT NULL DEFAULT 'qstash' CHECK(execution_mode IN ('qstash','resident'));
-- Preserve the original generation fence for all generation changes.
DROP TRIGGER queue_generation_advance_guard ON {{schema}}.queue_generations;
CREATE TRIGGER queue_generation_advance_guard BEFORE UPDATE OF active_generation,queue ON {{schema}}.queue_generations
FOR EACH ROW EXECUTE FUNCTION {{schema}}.enforce_queue_generation_advance();
CREATE FUNCTION {{schema}}.enforce_queue_runtime_switch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.execution_mode IS DISTINCT FROM OLD.execution_mode THEN
  IF OLD.queue <> 'chain' OR EXISTS(SELECT 1 FROM {{schema}}.jobs WHERE queue=OLD.queue AND state='leased')
    OR EXISTS(SELECT 1 FROM {{schema}}.outbox_messages WHERE queue=OLD.queue AND state='leased') THEN
   RAISE EXCEPTION 'execution mode switch requires drained chain leases';
  END IF;
 END IF;
 NEW.updated_at=now();
 RETURN NEW;
END;
$$;
CREATE TRIGGER queue_runtime_switch_guard BEFORE UPDATE OF execution_mode ON {{schema}}.queue_generations
FOR EACH ROW EXECUTE FUNCTION {{schema}}.enforce_queue_runtime_switch();
REVOKE ALL ON FUNCTION {{schema}}.enforce_queue_runtime_switch() FROM PUBLIC;
CREATE INDEX jobs_due_generation ON {{schema}}.jobs(queue,generation,next_attempt_at,id) WHERE state IN ('pending','retry');
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0013_resident_queue');
