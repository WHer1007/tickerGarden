-- +goose Up
ALTER TABLE tickergarden.treasury_jobs ADD COLUMN recovery_count integer NOT NULL DEFAULT 0 CHECK(recovery_count>=0);
CREATE TABLE tickergarden.treasury_job_audit (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_id text NOT NULL REFERENCES tickergarden.treasury_jobs(id),
 event_type text NOT NULL,
 previous_state text,
 state text NOT NULL,
 attempts integer NOT NULL,
 recovery_count integer NOT NULL,
 candidate_id text,
 error_code text NOT NULL,
 actor text NOT NULL DEFAULT session_user,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX treasury_job_audit_history ON tickergarden.treasury_job_audit(job_id,sequence);
-- Existing history is unknown; import current state without inventing past attempts.
INSERT INTO tickergarden.treasury_job_audit(job_id,event_type,state,attempts,recovery_count,candidate_id,error_code)
 SELECT id,'imported',state,attempts,recovery_count,candidate_id,error_code FROM tickergarden.treasury_jobs;
CREATE TABLE tickergarden.treasury_job_recoveries (
 operation_id text PRIMARY KEY CHECK(operation_id ~ '^0x[0-9a-f]{64}$'),
 job_id text NOT NULL REFERENCES tickergarden.treasury_jobs(id),
 expected_recovery integer NOT NULL CHECK(expected_recovery>=0),
 recovery_count integer NOT NULL CHECK(recovery_count=expected_recovery+1),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 512),
 observed_hash text NOT NULL,
 actor text NOT NULL DEFAULT session_user,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(job_id,recovery_count)
);
-- +goose StatementBegin
CREATE FUNCTION tickergarden.audit_treasury_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tickergarden AS $$
DECLARE kind text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.recovery_count<>OLD.recovery_count OR (OLD.state='dead' AND NEW.state='ready')) THEN
  IF OLD.state<>'dead' OR NEW.state<>'ready' OR NEW.recovery_count<>OLD.recovery_count+1 OR NEW.attempts<>0
    OR NOT EXISTS(SELECT 1 FROM tickergarden.treasury_job_recoveries r WHERE r.job_id=NEW.id AND r.expected_recovery=OLD.recovery_count AND r.recovery_count=NEW.recovery_count AND r.actor=session_user)
  THEN RAISE EXCEPTION 'Treasury recovery requires a recorded operator authorization'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN kind:='enqueued';
 ELSIF OLD.state IS NOT DISTINCT FROM NEW.state AND OLD.attempts=NEW.attempts
   AND OLD.recovery_count=NEW.recovery_count AND OLD.candidate_id IS NOT DISTINCT FROM NEW.candidate_id
   AND OLD.error_code=NEW.error_code AND OLD.lease_until IS NOT DISTINCT FROM NEW.lease_until
   AND OLD.payload=NEW.payload AND OLD.chain_id=NEW.chain_id AND OLD.manifest_hash=NEW.manifest_hash
 THEN RETURN NEW;
 ELSIF NEW.recovery_count>OLD.recovery_count THEN kind:='reopened';
 ELSIF NEW.state='running' AND OLD.state='running' AND NEW.attempts>OLD.attempts THEN kind:='reclaimed';
 ELSIF NEW.state='running' AND NEW.attempts>OLD.attempts THEN kind:='claimed';
 ELSIF NEW.state='succeeded' THEN kind:='succeeded';
 ELSIF NEW.error_code='invalid_payload' THEN kind:='quarantined';
 ELSIF NEW.state='dead' THEN kind:='exhausted';
 ELSIF NEW.state='ready' AND OLD.state='running' THEN kind:='failed';
 ELSE kind:='modified'; END IF;
 INSERT INTO tickergarden.treasury_job_audit(job_id,event_type,previous_state,state,attempts,recovery_count,candidate_id,error_code)
 VALUES(NEW.id,kind,CASE WHEN TG_OP='UPDATE' THEN OLD.state ELSE NULL END,NEW.state,NEW.attempts,NEW.recovery_count,NEW.candidate_id,NEW.error_code);
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER treasury_job_audit AFTER INSERT OR UPDATE ON tickergarden.treasury_jobs FOR EACH ROW EXECUTE FUNCTION tickergarden.audit_treasury_job();
-- +goose StatementBegin
CREATE FUNCTION tickergarden.reject_treasury_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Treasury audit records are append only'; END $$;
-- +goose StatementEnd
CREATE TRIGGER treasury_audit_immutable BEFORE UPDATE OR DELETE ON tickergarden.treasury_job_audit FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
CREATE TRIGGER treasury_recovery_immutable BEFORE UPDATE OR DELETE ON tickergarden.treasury_job_recoveries FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
-- +goose Down
DROP TRIGGER treasury_job_audit ON tickergarden.treasury_jobs;
DROP FUNCTION tickergarden.audit_treasury_job();
DROP TABLE tickergarden.treasury_job_recoveries;
DROP TABLE tickergarden.treasury_job_audit;
DROP FUNCTION tickergarden.reject_treasury_audit_mutation();
ALTER TABLE tickergarden.treasury_jobs DROP COLUMN recovery_count;
