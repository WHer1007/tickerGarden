"""Durable projection checks on synthetic protocol events in isolated services."""
import json
import signal
import subprocess
import time


def run(root, env, rpc, manifest_path, start, receipt, sql):
    staking = env.get("TG_SMOKE_STAKING") == "1"
    enabled = "true" if staking else "false"
    worker_env = dict(env, TG_PROJECTION_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"],
                      TG_DEPLOYMENT_MANIFEST=str(manifest_path), TG_PROJECTION_START_BLOCK=str(start))
    command = [str(root / "bin/projection-worker"), "--once"]

    def step(expected=None, failure=None):
        result = subprocess.run(command, env=worker_env, capture_output=True, text=True)
        if failure:
            assert result.returncode != 0 and failure in result.stderr, result.stderr
            return
        if result.returncode:
            raise RuntimeError("projection worker failed: " + result.stderr)
        body = json.loads(result.stdout)
        if expected:
            assert body["action"] == expected, body
        return body

    created = int(receipt["blockNumber"], 16)
    for height in range(start, created):
        body = step("projected")
        assert body["blockNumber"] == height and body["events"] == 0
    block_hash = receipt["blockHash"]
    # A second corrupt fixture log fails after the first event has written its
    # staged rows. PostgreSQL must roll the entire block back.
    sql("INSERT INTO tickergarden.chain_logs(chain_id,block_hash,log_index,address,payload) SELECT chain_id,block_hash,1,address,jsonb_set(jsonb_set(payload,'{logIndex}','\"0x1\"'::jsonb),'{data}','\"0x\"'::jsonb) FROM tickergarden.chain_logs WHERE chain_id=46630 AND block_hash='" + block_hash + "' AND log_index=0")
    step(failure="length mismatch")
    assert sql("SELECT count(*) FROM tickergarden.projection_inputs") == "0"
    assert sql("SELECT count(*) FROM tickergarden.projection_rows") == "0"
    assert sql("SELECT tip_number FROM tickergarden.projection_checkpoints WHERE chain_id=46630") == str(created - 1)
    sql("DELETE FROM tickergarden.chain_logs WHERE chain_id=46630 AND block_hash='" + block_hash + "' AND log_index=1")
    # A block-end observation failure must roll back already staged event rows.
    original_config = sql("SELECT payload->'state'->>'launchConfigId' FROM tickergarden.discovered_markets WHERE block_hash='" + block_hash + "'")
    assert original_config.isdecimal()
    sql("UPDATE tickergarden.discovered_markets SET payload=jsonb_set(payload,'{state,launchConfigId}',to_jsonb('999999'::text)) WHERE block_hash='" + block_hash + "'")
    step(failure="market observation identity changed")
    assert sql("SELECT count(*) FROM tickergarden.projection_inputs") == "0"
    assert sql("SELECT count(*) FROM tickergarden.projection_block_observations") == "0"
    assert sql("SELECT count(*) FROM tickergarden.projection_observation_batches WHERE block_hash='" + block_hash + "'") == "0"
    sql("UPDATE tickergarden.discovered_markets SET payload=jsonb_set(payload,'{state,launchConfigId}',to_jsonb('" + original_config + "'::text)) WHERE block_hash='" + block_hash + "'")
    # Fail after the new principal checkpoint is staged, before batch commit.
    sql("CREATE FUNCTION tickergarden.smoke_reject_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'checkpoint rollback test'; END $$")
    sql("CREATE TRIGGER smoke_reject_batch BEFORE INSERT ON tickergarden.projection_observation_batches FOR EACH ROW EXECUTE FUNCTION tickergarden.smoke_reject_batch()")
    step(failure="cannot persist observation batch")
    assert sql("SELECT count(*) FROM tickergarden.principal_checkpoints WHERE block_hash='" + block_hash + "'") == "0"
    assert sql("SELECT count(*) FROM tickergarden.projection_inputs") == "0"
    assert sql("SELECT count(*) FROM tickergarden.reconciliation_runs WHERE block_hash='" + block_hash + "'") == "0"
    assert sql("SELECT count(*) FROM tickergarden.user_activity_blocks WHERE block_hash='" + block_hash + "'") == "0"
    assert sql("SELECT count(*) FROM tickergarden.user_activity_records WHERE block_hash='" + block_hash + "'") == "0"
    assert sql("SELECT count(*) FROM tickergarden.reconciliation_probes WHERE block_hash='" + block_hash + "'") == "0"
    sql("DROP TRIGGER smoke_reject_batch ON tickergarden.projection_observation_batches")
    sql("DROP FUNCTION tickergarden.smoke_reject_batch()")
    body = step("projected")
    assert body["events"] == 1 and body["blockNumber"] == created
    assert sql("SELECT count(*) FROM tickergarden.user_activity_blocks WHERE block_hash='" + block_hash + "'") == "1"
    assert sql("SELECT count(*) FROM tickergarden.principal_checkpoints WHERE block_hash='" + block_hash + "'") == "1"
    # Reconstruct an old activity batch without replaying or moving business state.
    checkpoint_before = sql("SELECT row_to_json(p)::text FROM tickergarden.projection_checkpoints p WHERE chain_id=46630")
    activity_before = sql("SELECT records_hash FROM tickergarden.user_activity_blocks WHERE chain_id=46630 AND block_hash='" + block_hash + "'")
    sql("DELETE FROM tickergarden.user_activity_blocks WHERE chain_id=46630 AND block_hash='" + block_hash + "'")
    backfill = subprocess.run([str(root / "bin/projection-worker"), "--backfill-activity-once"], env=worker_env, capture_output=True, text=True)
    assert backfill.returncode == 0, backfill.stderr
    assert json.loads(backfill.stdout)["action"] == "activity_backfilled", backfill.stdout
    assert json.loads(backfill.stdout)["blockNumber"] == created, backfill.stdout
    assert sql("SELECT records_hash FROM tickergarden.user_activity_blocks WHERE chain_id=46630 AND block_hash='" + block_hash + "'") == activity_before
    assert sql("SELECT row_to_json(p)::text FROM tickergarden.projection_checkpoints p WHERE chain_id=46630") == checkpoint_before
    try:
        sql("UPDATE tickergarden.principal_checkpoints SET digest=digest WHERE block_hash='" + block_hash + "'")
    except subprocess.CalledProcessError:
        pass
    else:
        raise AssertionError("principal checkpoint is mutable")

    assert sql("SELECT expected_count::text||':'||completed_count::text||':'||missing_count::text FROM tickergarden.canonical_reconciliation_runs WHERE block_hash='" + block_hash + "'") == "0:0:0"
    assert sql("SELECT convert_from(payload,'UTF8')::jsonb->>'publicationEligible' FROM tickergarden.canonical_reconciliation_runs WHERE block_hash='" + block_hash + "'") == "false"
    assert sql("SELECT count(*) FROM tickergarden.projection_inputs") == "1"
    assert sql("SELECT input_count FROM tickergarden.projection_checkpoints WHERE chain_id=46630") == "1"
    assert sql("SELECT payload->'values'->>'stakingEnabled' FROM tickergarden.canonical_projection_rows WHERE table_name='markets'") == enabled
    assert sql("SELECT payload->'values'->>'memeToken' FROM tickergarden.canonical_projection_rows WHERE table_name='markets'") == "0x" + format(0x2000, "040x")
    holder = env.get("TG_SMOKE_HOLDER") == "1"
    observation_count = (10 if staking else 6) + (3 if holder else 0) + 3 + 2 + 1  # creator dual-asset rewards and complete Curve observation
    assert sql("SELECT expected_count::text||':'||completed_count::text FROM tickergarden.projection_observation_batches WHERE block_hash='" + block_hash + "'") == f"{observation_count}:{observation_count}"
    assert sql("SELECT count(*) FROM tickergarden.canonical_block_observations") == str(observation_count)
    assert sql("SELECT value->>'tickSpacing' FROM tickergarden.canonical_block_observations WHERE kind='poolKey'") == "60"
    assert sql("SELECT value->>'curveTradingEnabled' FROM tickergarden.canonical_block_observations WHERE kind='canonicalRoute'") == "true"
    # Synthetic executor getter deliberately uses an existing deployed fixture.
    executor = sql("SELECT value->>'graduationExecutor' FROM tickergarden.canonical_block_observations WHERE kind='canonicalRoute'")
    assert executor.startswith("0x") and len(executor) == 42
    executor_code = rpc("eth_getCode", [executor, receipt["blockNumber"]])
    assert executor_code != "0x"
    assert sql("SELECT value->>'graduationExecutor' FROM tickergarden.canonical_block_observations WHERE kind='routeRuntime'") == rpc("web3_sha3", [executor_code])

    assert sql("SELECT value->>'stakingEnabled' FROM tickergarden.canonical_block_observations WHERE kind='market'") == enabled
    assert sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='feeSolvency'") == "2"
    assert sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='creatorEpoch'") == "1"
    creator_exit = json.loads(sql("SELECT value FROM tickergarden.canonical_block_observations WHERE kind='creatorEpoch'"))
    assert creator_exit["rawRewardExitAt"] == "1" and creator_exit["rawRewardExitReady"] is True
    assert int(creator_exit["observedAtTimestamp"]) >= 1

    if holder:
        assert sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='holderEpoch'") == "1"
        assert sql("SELECT value->>'outstandingQuoteAmount' FROM tickergarden.canonical_block_observations WHERE kind='holderEpoch'") == "3"
        assert sql("SELECT value->>'requiredBalance' FROM tickergarden.canonical_block_observations WHERE kind='treasurySolvency'") == "5"
        assert sql("SELECT bool_and((value->'checks'->>'balanceCoversLiabilities')::boolean AND (value->'checks'->>'knownHolderSumEqualsQuoteLiability')::boolean) FROM tickergarden.canonical_block_observations WHERE kind='treasurySolvency'") == "t"

    assert sql("SELECT bool_and((value->'checks'->>'knownMarketSumEqualsTotal')::boolean) FROM tickergarden.canonical_block_observations WHERE kind='feeSolvency'") == "t"
    assert sql("SELECT bool_and((value->'checks'->>'balanceCoversLiability')::boolean) FROM tickergarden.canonical_block_observations WHERE kind='feeSolvency'") == "t"
    if staking:
        assert sql("SELECT value->'asset'->>'minimumAllocation' FROM tickergarden.canonical_block_observations WHERE kind='asset'") == "414"
        assert sql("SELECT value->>'storedTotalActiveStock' FROM tickergarden.canonical_block_observations WHERE kind='gauge'") == "10"
        assert sql("SELECT value->>'effectiveTotalActiveStock' FROM tickergarden.canonical_block_observations WHERE kind='gauge'") == "8"
        assert sql("SELECT value->'quoteRewardState'->>'accFeePerShare' FROM tickergarden.canonical_block_observations WHERE kind='gauge'") == str(2**256 - 1)
        assert sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='gaugePosition'") == "0"
    step("idle")
    # Move the existing journal/discovery forward one finalized empty block.
    rpc("anvil_mine", ["0x1"])
    subprocess.run([str(root / "bin/indexer"), "--once"], env=env, capture_output=True, text=True, check=True)
    discovery_env = dict(env, TG_DISCOVERY_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"],
                         TG_DEPLOYMENT_MANIFEST=str(manifest_path), TG_DISCOVERY_START_BLOCK=str(start))
    subprocess.run([str(root / "bin/discovery-worker"), "--once"], env=discovery_env,
                   capture_output=True, text=True, check=True)
    digest = sql("SELECT digest FROM tickergarden.projection_inputs")
    payload_hex = sql("SELECT encode(payload,'hex') FROM tickergarden.projection_inputs")
    assert all(c in "0123456789abcdef" for c in payload_hex + digest[2:])
    sql("UPDATE tickergarden.projection_inputs SET digest='0x" + "0" * 64 + "'")
    step(failure="integrity mismatch")
    sql("UPDATE tickergarden.projection_inputs SET digest='" + digest + "'")
    sql("DELETE FROM tickergarden.projection_inputs")
    step(failure="input count mismatch")
    sql("INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES(46630,'" + block_hash + "',0,decode('" + payload_hex + "','hex'),'" + digest + "')")
    body = step("projected")
    assert body["blockNumber"] == created + 1 and body["events"] == 0
    assert sql("SELECT count(*) FROM tickergarden.principal_checkpoints p JOIN tickergarden.projection_checkpoints c ON c.chain_id=p.chain_id AND c.tip_hash=p.block_hash WHERE p.parent_hash='" + block_hash + "'") == "1"

    if holder:
        assert sql("SELECT count(DISTINCT block_hash) FROM tickergarden.canonical_block_observations WHERE kind='holderEpoch'") == "2"
        assert sql("SELECT count(DISTINCT block_hash) FROM tickergarden.canonical_block_observations WHERE kind='treasurySolvency'") == "2"
    assert sql("SELECT count(*) FROM tickergarden.projection_inputs") == "1"
    step("idle")
    process = subprocess.Popen([str(root / "bin/projection-worker"), "--run"], env=worker_env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        time.sleep(0.3)
        process.send_signal(signal.SIGTERM)
        out, err = process.communicate(timeout=5)
        assert process.returncode == 0 and worker_env["TG_PROJECTION_DATABASE_URL"] not in out + err
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    if env.get("TG_SMOKE_VAULT") == "1":
        import smoke_vault
        smoke_vault.run(root, env, worker_env, discovery_env, rpc, sql)
    # Real EVM event -> journal -> authenticated config row -> block-end record.
    account = rpc("eth_accounts", [])[0]
    config_tx = rpc("eth_sendTransaction", [{"from": account, "to": "0x" + format(0x1003, "040x"), "data": "0xfeedface", "gas": "0x50000"}])
    config_receipt = None
    for _ in range(50):
        config_receipt = rpc("eth_getTransactionReceipt", [config_tx])
        if config_receipt:
            break
        time.sleep(0.1)
    assert config_receipt and config_receipt["status"] == "0x1"
    for _ in range(4):
        if int(rpc("eth_getBlockByNumber", ["finalized", False])["number"], 16) >= int(config_receipt["blockNumber"], 16):
            break
        rpc("anvil_mine", ["0x20"])
    else:
        raise AssertionError("config fixture did not finalize")
    for executable, environment in [("indexer", env), ("discovery-worker", discovery_env), ("projection-worker", worker_env)]:
        for _ in range(100):
            result = subprocess.run([str(root / "bin" / executable), "--once"], env=environment, capture_output=True, text=True, check=True)
            if json.loads(result.stdout)["action"] == "idle":
                break
        else:
            raise AssertionError("config fixture did not converge")
    observed_supply = sql("SELECT DISTINCT value->>'supply' FROM tickergarden.canonical_block_observations WHERE kind='baseline'")
    assert observed_supply == "1000000", (observed_supply, sql("SELECT payload FROM tickergarden.projection_rows WHERE table_name='configs'"), rpc("eth_blockNumber", []))
    assert sql("SELECT DISTINCT value->>'tickSpacing' FROM tickergarden.canonical_block_observations WHERE kind='baseline'") == "60"
    assert sql("SELECT projector_version FROM tickergarden.projection_checkpoints WHERE chain_id=46630") == "V1-EXEC-11:business-facts-v25-asset-minimum"
    # Empty finalized blocks refresh the persisted directory without another event.
    before = int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='baseline'"))
    rpc("anvil_mine", ["0x20"])
    for executable, environment in [("indexer", env), ("discovery-worker", discovery_env), ("projection-worker", worker_env)]:
        for _ in range(100):
            result = subprocess.run([str(root / "bin" / executable), "--once"], env=environment, capture_output=True, text=True, check=True)
            if json.loads(result.stdout)["action"] == "idle":
                break
        else:
            raise AssertionError("empty config refresh did not converge")
    assert int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='baseline'")) > before
    if staking:
        import smoke_gauge_accounts
        smoke_gauge_accounts.run(root, env, worker_env, discovery_env, rpc, sql)
    import smoke_fee_claims
    smoke_fee_claims.run(root, env, worker_env, discovery_env, rpc, sql)
    print("Durable projection: authenticated discovery, block observations and rollback, restart replay, input digest/count and SIGTERM passed", flush=True)
