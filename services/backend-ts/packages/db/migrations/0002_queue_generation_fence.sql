CREATE TABLE {{schema}}.queue_generations (
  queue text PRIMARY KEY CHECK (queue IN ('chain','content')),
  active_generation bigint NOT NULL CHECK (active_generation >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO {{schema}}.queue_generations(queue,active_generation) VALUES ('chain',0),('content',0);

CREATE FUNCTION {{schema}}.enforce_queue_generation_advance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.queue <> OLD.queue OR NEW.active_generation <> OLD.active_generation + 1 THEN
    RAISE EXCEPTION 'queue generation must advance by exactly one';
  END IF;
  IF EXISTS (
    SELECT 1 FROM {{schema}}.jobs j
    WHERE j.queue=OLD.queue AND j.generation=OLD.active_generation
      AND (j.state <> 'succeeded' OR EXISTS (
        SELECT 1 FROM {{schema}}.outbox_messages o
        WHERE o.operation_id=j.operation_id AND o.state <> 'sent'
      ))
  ) THEN
    RAISE EXCEPTION 'queue generation cannot advance before successful drain';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_generation_advance_guard BEFORE UPDATE ON {{schema}}.queue_generations
FOR EACH ROW EXECUTE FUNCTION {{schema}}.enforce_queue_generation_advance();

REVOKE ALL ON {{schema}}.queue_generations FROM PUBLIC;
REVOKE ALL ON FUNCTION {{schema}}.enforce_queue_generation_advance() FROM PUBLIC;

INSERT INTO {{schema}}.schema_migrations(version) VALUES ('0002_queue_generation_fence');
