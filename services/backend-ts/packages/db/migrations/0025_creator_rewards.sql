-- Creator display balances are event-derived; contracts remain the claim authority.
CREATE TABLE {{schema}}.creator_reward_epochs (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 market_id text NOT NULL,epoch bigint NOT NULL CHECK(epoch>0),beneficiary text NOT NULL,block_hash text NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,epoch)
);
CREATE INDEX creator_epochs_wallet ON {{schema}}.creator_reward_epochs(environment,chain_id,deployment_digest,beneficiary,market_id,epoch DESC);
CREATE TABLE {{schema}}.creator_reward_balances (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 market_id text NOT NULL,epoch bigint NOT NULL,beneficiary text NOT NULL,asset text NOT NULL,
 credited numeric(78,0) NOT NULL CHECK(credited>=0),paid numeric(78,0) NOT NULL CHECK(paid>=0),
 burned numeric(78,0) NOT NULL CHECK(burned>=0),remaining numeric(78,0) NOT NULL CHECK(remaining>=0),block_hash text NOT NULL,
 CHECK(credited=paid+burned+remaining),PRIMARY KEY(environment,chain_id,deployment_digest,market_id,epoch,asset)
);
CREATE INDEX creator_balances_wallet ON {{schema}}.creator_reward_balances(environment,chain_id,deployment_digest,beneficiary,market_id,epoch DESC,asset);
CREATE INDEX creator_directory_account ON {{schema}}.aggregate_records(environment,chain_id,deployment_digest,(payload->>'creator'),identity) WHERE scope='creator-market' AND complete;
CREATE INDEX creator_pending_account ON {{schema}}.aggregate_records(environment,chain_id,deployment_digest,(payload->>'pendingBeneficiary'),identity) WHERE scope='creator-state' AND complete;
CREATE INDEX creator_history_latest ON {{schema}}.history_contributions(environment,chain_id,deployment_digest,scope,identity,block_number DESC);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0025_creator_rewards');
