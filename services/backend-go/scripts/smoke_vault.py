"""Register an asset and deposit before any staking market exists (isolated Anvil)."""
import json
import signal
import subprocess


def run(root, env, worker_env, discovery_env, rpc, sql):
    account = rpc("eth_accounts", [])[0]
    registry = "0x" + format(0x1001, "040x")
    vault = "0x" + format(0x3000, "040x")
    rpc("evm_setAutomine", [False])
    try:
        registration = rpc("eth_sendTransaction", [{"from": account, "to": registry, "data": "0xfeedface", "gas": "0x186a0"}])
        deposit = rpc("eth_sendTransaction", [{"from": account, "to": vault, "data": "0xfeedface", "gas": "0x186a0"}])
        rpc("anvil_mine", ["0x1"])
    finally:
        rpc("evm_setAutomine", [True])
    receipts = [rpc("eth_getTransactionReceipt", [tx]) for tx in [registration, deposit]]
    assert all(r and r["status"] == "0x1" for r in receipts), receipts
    assert receipts[0]["blockHash"] == receipts[1]["blockHash"]
    target = int(receipts[0]["blockNumber"], 16)
    for _ in range(4):
        if int(rpc("eth_getBlockByNumber", ["finalized", False])["number"], 16) >= target:
            break
        rpc("anvil_mine", ["0x20"])
    else:
        raise RuntimeError("Vault fixture did not finalize")

    def catchup(name, process_env):
        process = subprocess.Popen([str(root / ("bin/" + name)), "--run"], env=process_env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for line in process.stdout:
                body = json.loads(line)
                if body["action"] == "idle":
                    process.send_signal(signal.SIGTERM)
                    out, err = process.communicate(timeout=10)
                    assert process.returncode == 0, err
                    return
            out, err = process.communicate(timeout=10)
            raise RuntimeError(name + " stopped before idle: " + err)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=5)

    for name, process_env in [("indexer", env), ("discovery-worker", discovery_env), ("projection-worker", worker_env)]:
        catchup(name, process_env)
    assert sql("SELECT count(*) FROM tickergarden.canonical_projection_rows WHERE table_name='configs' AND payload->>'kind'='asset'") == "1"
    assert int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='vaultPosition'")) >= 1
    assert sql("SELECT DISTINCT value->>'deposited' FROM tickergarden.canonical_block_observations WHERE kind='vaultPosition'") == "90"
    assert sql("SELECT value->'checks'->>'freeEqualsDepositedMinusAllocated' FROM tickergarden.canonical_block_observations WHERE kind='vaultPosition'") == "true"
    assert sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='vaultMarket'") == "0"
    # Another finalized empty block must recover the asset from persisted config
    # in a fresh process, independent of any staking market or new deposit event.
    rpc("anvil_mine", ["0x1"])
    before = int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='vaultSolvency'"))
    accounts_before = int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='vaultPosition'"))
    for name, process_env in [("indexer", env), ("discovery-worker", discovery_env), ("projection-worker", worker_env)]:
        catchup(name, process_env)
    assert sql("SELECT DISTINCT value->>'knownUserDepositedSum' FROM tickergarden.canonical_block_observations WHERE kind='vaultSolvency'") == "90"
    assert sql("SELECT DISTINCT value->'checks'->>'knownUserSumEqualsDeposited' FROM tickergarden.canonical_block_observations WHERE kind='vaultSolvency'") == "false"
    after = int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='vaultSolvency'"))
    assert after == before + 1
    assert int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='vaultPosition'")) == accounts_before + 1
    assert sql("SELECT DISTINCT value->'eventBalance'->>'deposited' FROM tickergarden.canonical_block_observations WHERE kind='principalAccount'") == "90"
    assert sql("SELECT DISTINCT value->'eventBalance'->>'allocated' FROM tickergarden.canonical_block_observations WHERE kind='principalAccount'") == "0"
    assert sql("SELECT DISTINCT value->'checks'->>'depositedMatches' FROM tickergarden.canonical_block_observations WHERE kind='principalAccount'") == "true"
    assert sql("SELECT DISTINCT value->'checks'->>'allocatedMatches' FROM tickergarden.canonical_block_observations WHERE kind='principalAccount'") == "false"
    assert sql("SELECT DISTINCT expected_count::text||':'||completed_count::text||':'||failed_count::text||':'||missing_count::text FROM tickergarden.canonical_reconciliation_runs WHERE expected_count>0") == "6:6:4:0"
    assert sql("SELECT DISTINCT expected_value||':'||actual_value||':'||status FROM tickergarden.canonical_reconciliation_probes WHERE field='allocated'") == "0:50:mismatch"
    assert sql("SELECT DISTINCT expected_value||':'||actual_value||':'||status FROM tickergarden.canonical_reconciliation_probes WHERE field='deposited'") == "90:90:matched"
    assert sql("SELECT bool_and(expected_count=jsonb_array_length(convert_from(payload,'UTF8')::jsonb->'probes')) FROM tickergarden.canonical_reconciliation_runs") == "t"
    assert sql("SELECT count(*) FROM tickergarden.canonical_reconciliation_probes") == sql("SELECT sum(expected_count) FROM tickergarden.canonical_reconciliation_runs")
    assert sql("SELECT DISTINCT expected_value||':'||actual_value||':'||status FROM tickergarden.canonical_reconciliation_probes WHERE field='totalDeposited'") == "90:100:mismatch"
    assert sql("SELECT DISTINCT expected_value||':'||actual_value||':'||status||':'||comparison FROM tickergarden.canonical_reconciliation_probes WHERE field='tokenBalance'") == "90:100:matched:atLeast"
    for table in ["reconciliation_runs", "reconciliation_probes"]:
        try:
            sql("DELETE FROM tickergarden." + table)
        except subprocess.CalledProcessError:
            pass
        else:
            raise AssertionError("reconciliation evidence is mutable")
    inspect_env = dict(env, TG_RECONCILIATION_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"])
    tip_hash = sql("SELECT tip_hash FROM tickergarden.projection_checkpoints WHERE chain_id=46630")
    inspect_command = [str(root / "bin/reconciliation-inspect"), "46630", tip_hash]
    def inspect_failure():
        result = subprocess.run(inspect_command, env=inspect_env, capture_output=True, text=True)
        assert result.returncode != 0 and "reconciliation evidence unavailable or inconsistent" in result.stderr
        assert not result.stdout
    verified = json.loads(subprocess.run(inspect_command, env=inspect_env, capture_output=True, text=True, check=True).stdout)
    assert verified["evidenceVerified"] and verified["blockHash"] == tip_hash
    assert verified["coverage"]["completeReceiptsVerified"] and verified["coverage"]["receiptRootsVerified"]
    assert verified["report"]["expected"] == 6 and verified["report"]["failed"] == 4
    assert not verified["report"]["historyComplete"] and not verified["report"]["publicationEligible"]
    # Removing evidence must downgrade coverage, not claim a cryptographic proof.
    # Changing receipt inventory must reject even if root metadata is unchanged.
    root_row = sql("SELECT receipts_root||'|'||root_receipt_set_hash||'|'||receipt_count FROM tickergarden.chain_blocks WHERE chain_id=46630 AND hash='" + tip_hash + "'")
    receipt_root, root_binding, receipt_count = root_row.split("|")
    assert receipt_root.startswith("0x") and len(receipt_root) == 66
    assert root_binding.startswith("sha256:") and len(root_binding) == 71 and all(c in "0123456789abcdef" for c in root_binding[7:])
    assert all(c in "0123456789abcdef" for c in receipt_root[2:])
    count = int(receipt_count)
    where = "chain_id=46630 AND hash='" + tip_hash + "'"
    try:
        sql("UPDATE tickergarden.chain_blocks SET receipts_root=NULL,root_receipt_set_hash=NULL WHERE " + where)
        partial = json.loads(subprocess.run(inspect_command, env=inspect_env, capture_output=True, text=True, check=True).stdout)
        assert partial["coverage"]["completeReceiptsVerified"]
        assert not partial["coverage"]["receiptRootsVerified"]
        assert not partial["report"]["publicationEligible"]
    finally:
        sql("UPDATE tickergarden.chain_blocks SET receipts_root='" + receipt_root + "',root_receipt_set_hash='" + root_binding + "' WHERE " + where)
    try:
        sql("UPDATE tickergarden.chain_blocks SET receipt_count=" + str(count + 1) + " WHERE " + where)
        inspect_failure()
    finally:
        sql("UPDATE tickergarden.chain_blocks SET receipt_count=" + str(count) + " WHERE " + where)
    recovered = json.loads(subprocess.run(inspect_command, env=inspect_env, capture_output=True, text=True, check=True).stdout)
    assert recovered["coverage"]["completeReceiptsVerified"] and recovered["coverage"]["receiptRootsVerified"]

    replay_location = sql("SELECT block_hash||':'||log_index FROM tickergarden.projection_inputs WHERE convert_from(payload,'UTF8')::jsonb->>'module'='UserStockVault' LIMIT 1")
    replay_hash, replay_index = replay_location.split(":")
    replay_where = "chain_id=46630 AND block_hash='" + replay_hash + "' AND log_index=" + replay_index
    replay_hex = sql("SELECT encode(payload,'hex') FROM tickergarden.projection_inputs WHERE " + replay_where)
    replay_digest = sql("SELECT digest FROM tickergarden.projection_inputs WHERE " + replay_where)
    sql("DELETE FROM tickergarden.projection_inputs WHERE " + replay_where)
    inspect_failure()
    sql("INSERT INTO tickergarden.projection_inputs(chain_id,block_hash,log_index,payload,digest) VALUES(46630,'" + replay_hash + "'," + replay_index + ",decode('" + replay_hex + "','hex'),'" + replay_digest + "')")
    replay_input = json.loads(bytes.fromhex(replay_hex))
    original_data = replay_input["log"]["data"]
    assert int(original_data, 16) == 90
    changed_data = "0x" + format(89, "064x")
    # Raw journal disagreement must fail even if the checkpoint still matches getters.
    sql("UPDATE tickergarden.chain_logs SET payload=jsonb_set(payload,'{data}',to_jsonb('" + changed_data + "'::text)) WHERE " + replay_where)
    inspect_failure()
    # Make raw log and input agree, including a correct input digest: replay must
    # still reject because the resulting 89 principal differs from checkpoint 90.
    replay_input["log"]["data"] = changed_data
    changed_hex = json.dumps(replay_input, separators=(",", ":")).encode().hex()
    changed_digest = rpc("web3_sha3", ["0x" + changed_hex])
    sql("UPDATE tickergarden.projection_inputs SET payload=decode('" + changed_hex + "','hex'),digest='" + changed_digest + "' WHERE " + replay_where)
    inspect_failure()
    sql("UPDATE tickergarden.chain_logs SET payload=jsonb_set(payload,'{data}',to_jsonb('" + original_data + "'::text)) WHERE " + replay_where)
    sql("UPDATE tickergarden.projection_inputs SET payload=decode('" + replay_hex + "','hex'),digest='" + replay_digest + "' WHERE " + replay_where)
    coverage = verified["coverage"]
    assert coverage["eventReplayVerified"]
    assert coverage["replayedInputs"] == sql("SELECT input_count FROM tickergarden.projection_checkpoints WHERE chain_id=46630")
    assert coverage["journalContinuous"] and coverage["principalCheckpointsContinuous"]
    assert not coverage["deploymentStartVerified"]
    assert coverage["blockCount"] == int(coverage["endBlock"]) - int(coverage["startBlock"]) + 1
    middle = int(coverage["startBlock"]) + 1
    assert middle < int(coverage["endBlock"])
    middle_hash = sql("SELECT hash FROM tickergarden.chain_blocks WHERE canonical AND chain_id=46630 AND number=" + str(middle))
    original_parent = sql("SELECT parent_hash FROM tickergarden.chain_blocks WHERE chain_id=46630 AND hash='" + middle_hash + "'")
    sql("UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=46630 AND hash='" + middle_hash + "'")
    inspect_failure()
    sql("UPDATE tickergarden.chain_blocks SET canonical=true,receipts_verified=false WHERE chain_id=46630 AND hash='" + middle_hash + "'")
    inspect_failure()
    sql("UPDATE tickergarden.chain_blocks SET receipts_verified=true,parent_hash=hash WHERE chain_id=46630 AND hash='" + middle_hash + "'")
    inspect_failure()
    sql("UPDATE tickergarden.chain_blocks SET parent_hash='" + original_parent + "' WHERE chain_id=46630 AND hash='" + middle_hash + "'")
    original_time = sql("SELECT block_timestamp FROM tickergarden.chain_blocks WHERE chain_id=46630 AND hash='" + middle_hash + "'")
    sql("UPDATE tickergarden.chain_blocks SET block_timestamp=0 WHERE chain_id=46630 AND hash='" + middle_hash + "'")
    inspect_failure()
    sql("UPDATE tickergarden.chain_blocks SET block_timestamp=" + original_time + " WHERE chain_id=46630 AND hash='" + middle_hash + "'")
    sql("ALTER TABLE tickergarden.principal_checkpoints DISABLE TRIGGER principal_checkpoint_immutable")
    sql("UPDATE tickergarden.principal_checkpoints SET parent_hash=block_hash WHERE chain_id=46630 AND block_hash='" + middle_hash + "'")
    inspect_failure()
    sql("UPDATE tickergarden.principal_checkpoints SET parent_hash='" + original_parent + "' WHERE chain_id=46630 AND block_hash='" + middle_hash + "'")
    sql("ALTER TABLE tickergarden.principal_checkpoints ENABLE TRIGGER principal_checkpoint_immutable")
    assert json.loads(subprocess.run(inspect_command, env=inspect_env, capture_output=True, text=True, check=True).stdout)["coverage"] == coverage
    # Isolated fault injection: bypass immutability only to exercise the reader.
    report_hex = sql("SELECT encode(payload,'hex') FROM tickergarden.reconciliation_runs WHERE block_hash='" + tip_hash + "'")
    sql("ALTER TABLE tickergarden.reconciliation_runs DISABLE TRIGGER reconciliation_run_immutable")
    sql("WITH changed AS (SELECT convert_to(jsonb_set(convert_from(payload,'UTF8')::jsonb,'{failed}','0'::jsonb)::text,'UTF8') AS bytes FROM tickergarden.reconciliation_runs WHERE block_hash='" + tip_hash + "') UPDATE tickergarden.reconciliation_runs SET payload=changed.bytes,digest=encode(sha256(changed.bytes),'hex') FROM changed WHERE block_hash='" + tip_hash + "'")
    inspect_failure()
    sql("UPDATE tickergarden.reconciliation_runs SET payload=decode('" + report_hex + "','hex'),digest=encode(sha256(decode('" + report_hex + "','hex')),'hex') WHERE block_hash='" + tip_hash + "'")
    sql("ALTER TABLE tickergarden.reconciliation_runs ENABLE TRIGGER reconciliation_run_immutable")

    sql("ALTER TABLE tickergarden.reconciliation_probes DISABLE TRIGGER reconciliation_probe_immutable")
    sql("UPDATE tickergarden.reconciliation_probes SET expected_value='91',status='mismatch' WHERE block_hash='" + tip_hash + "' AND field='deposited'")
    inspect_failure()
    sql("UPDATE tickergarden.reconciliation_probes SET expected_value='90',status='matched' WHERE block_hash='" + tip_hash + "' AND field='deposited'")
    sql("ALTER TABLE tickergarden.reconciliation_probes ENABLE TRIGGER reconciliation_probe_immutable")

    sql("UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=46630 AND hash='" + tip_hash + "'")
    assert sql("SELECT count(*) FROM tickergarden.canonical_reconciliation_runs") == "0"
    inspect_failure()
    assert sql("SELECT count(*) FROM tickergarden.canonical_reconciliation_probes") == "0"
    sql("UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=46630 AND hash='" + tip_hash + "'")
    import smoke_status
    smoke_status.run(root, env, sql, rpc)
    print("Vault pipeline: same-block registration/deposit without market, principal checks and empty-block restart refresh passed", flush=True)
