"""Exercise durable discovery against the isolated Anvil/PostgreSQL fixtures."""
import json
import os
import shutil
import signal
import subprocess
import time
import smoke_projection


def run(root, data, env, rpc, manifest_path, start, receipt):
    dsn = env["TG_INDEXER_DATABASE_URL"]
    psql = shutil.which("psql")

    def sql(query):
        return subprocess.run([psql, dsn, "-At", "-v", "ON_ERROR_STOP=1", "-c", query],
                              capture_output=True, text=True, check=True).stdout.strip()

    worker_env = dict(env, TG_DISCOVERY_DATABASE_URL=dsn,
                      TG_DEPLOYMENT_MANIFEST=str(manifest_path), TG_DISCOVERY_START_BLOCK=str(start))
    command = [str(root / "bin/discovery-worker"), "--once"]

    def step(expected=None, override=None, fail=False):
        response = subprocess.run(command, env=override or worker_env, capture_output=True, text=True)
        if fail:
            assert response.returncode != 0, response.stdout
            return response.stderr
        if response.returncode:
            raise RuntimeError("discovery worker failed: " + response.stderr)
        result = json.loads(response.stdout)
        if expected:
            assert result["action"] == expected, result
        return result

    # The earlier journal has not indexed the synthetic deployment yet.
    step("idle")
    locker = subprocess.Popen([psql, dsn, "-At", "-v", "ON_ERROR_STOP=1", "-c",
                               "BEGIN; SELECT pg_advisory_xact_lock(730046630); SELECT pg_sleep(30); ROLLBACK"],
                              env=dict(os.environ, PGAPPNAME="tg_discovery_smoke_lock"),
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            held = sql("SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='tg_discovery_smoke_lock' AND a.datname=current_database() AND l.locktype='advisory' AND l.granted)")
            if held == "t":
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("fixture could not acquire shared journal/discovery lock")
        step("busy")
    finally:
        sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='tg_discovery_smoke_lock' AND datname=current_database()")
        locker.wait(timeout=5)
    indexer = subprocess.Popen([str(root / "bin/indexer"), "--run"], env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        caught_up = False
        for line in indexer.stdout:
            if json.loads(line)["action"] == "idle":
                caught_up = True
                break
        if not caught_up:
            raise RuntimeError("local journal catchup failed: " + indexer.stderr.read())
        indexer.send_signal(signal.SIGTERM)
        _, errors = indexer.communicate(timeout=10)
        assert indexer.returncode == 0, errors
    finally:
        if indexer.poll() is None:
            indexer.kill()
            indexer.wait()
    # Every step is a fresh OS process: persisted cursor, not process memory.
    created = int(receipt["blockNumber"], 16)
    for height in range(start, created):
        result = step("discovered")
        assert result["blockNumber"] == height and result["markets"] == 0
    before = sql("SELECT tip_number FROM tickergarden.discovery_checkpoints WHERE chain_id=46630")
    assert int(before) == created - 1
    block_hash = receipt["blockHash"]
    source_filter = "chain_id=46630 AND block_hash='" + block_hash + "'"
    original = sql("SELECT payload->>'data' FROM tickergarden.chain_logs WHERE " + source_filter)
    sql("UPDATE tickergarden.chain_logs SET payload=jsonb_set(payload,'{data}','\"0x\"'::jsonb) WHERE " + source_filter)
    assert "differs from journal" in step(fail=True)
    assert sql("SELECT tip_number FROM tickergarden.discovery_checkpoints WHERE chain_id=46630") == before
    assert sql("SELECT count(*) FROM tickergarden.discovery_batches WHERE " + source_filter) == "0"
    assert original.startswith("0x") and all(c in "0123456789abcdefABCDEF" for c in original[2:])
    sql("UPDATE tickergarden.chain_logs SET payload=jsonb_set(payload,'{data}',to_jsonb('" + original + "'::text)) WHERE " + source_filter)
    # Inject a prior canonical identity in the isolated fixture to exercise the
    # across-block uniqueness check (the real Factory itself forbids this).
    prior_hash = rpc("eth_getBlockByNumber", ["0x1", False])["hash"]
    sql("INSERT INTO tickergarden.discovery_batches(chain_id,block_hash) VALUES(46630,'" + prior_hash + "')")
    sql("INSERT INTO tickergarden.discovered_markets(chain_id,block_hash,market_id,log_index,payload) VALUES(46630,'" + prior_hash + "','0x" + "11" * 32 + "',0,'{}')")
    assert "already discovered" in step(fail=True)
    assert sql("SELECT tip_number FROM tickergarden.discovery_checkpoints WHERE chain_id=46630") == before
    sql("DELETE FROM tickergarden.discovered_markets WHERE chain_id=46630 AND block_hash='" + prior_hash + "'")
    sql("DELETE FROM tickergarden.discovery_batches WHERE chain_id=46630 AND block_hash='" + prior_hash + "'")
    result = step("discovered")
    assert result["blockNumber"] == created and result["markets"] == 1
    assert sql("SELECT count(*) FROM tickergarden.canonical_discovered_markets") == "1"
    assert sql("SELECT payload->>'marketId' FROM tickergarden.canonical_discovered_markets") == "0x" + "11" * 32
    # Scope cannot silently change; harmless input ordering can.
    assert "start block changed" in step(override=dict(worker_env, TG_DISCOVERY_START_BLOCK=str(start + 1)), fail=True)
    manifest = json.loads(manifest_path.read_text())
    reordered = data / "reordered-discovery-manifest.json"
    manifest["contracts"].reverse()
    reordered.write_text(json.dumps(manifest))
    assert step(override=dict(worker_env, TG_DEPLOYMENT_MANIFEST=str(reordered)))["action"] in ("discovered", "idle")
    manifest["contracts"][0]["runtimeCodeHash"] = "0x" + "0" * 64
    reordered.write_text(json.dumps(manifest))
    assert "manifest or start block changed" in step(override=dict(worker_env, TG_DEPLOYMENT_MANIFEST=str(reordered)), fail=True)
    # Invalidation removes canonical visibility but keeps the audit row intact.
    saved_tip = sql("SELECT tip_number FROM tickergarden.discovery_checkpoints WHERE chain_id=46630")
    tip_hash = sql("SELECT tip_hash FROM tickergarden.discovery_checkpoints WHERE chain_id=46630")
    sql("UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=46630 AND hash IN ('" + block_hash + "','" + tip_hash + "')")
    assert sql("SELECT count(*) FROM tickergarden.canonical_discovered_markets") == "0"
    assert sql("SELECT count(*) FROM tickergarden.discovered_markets") == "1"
    assert "checkpoint invalidated" in step(fail=True)
    assert sql("SELECT tip_number FROM tickergarden.discovery_checkpoints WHERE chain_id=46630") == saved_tip
    sql("UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=46630 AND hash IN ('" + block_hash + "','" + tip_hash + "')")
    assert sql("SELECT count(*) FROM tickergarden.canonical_discovered_markets") == "1"
    # Drain to journal finality, then prove repeated idle does not duplicate data.
    for _ in range(128):
        if step()["action"] == "idle":
            break
    else:
        raise RuntimeError("local discovery catchup exceeded fixture bound")
    step("idle")
    assert sql("SELECT count(*) FROM tickergarden.discovered_markets") == "1"
    process = subprocess.Popen([str(root / "bin/discovery-worker"), "--run"], env=worker_env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        time.sleep(0.3)
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == 0 and dsn not in stdout + stderr
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    smoke_projection.run(root, env, rpc, manifest_path, start, receipt, sql)
    print("Durable discovery: shared lock, restart, source rollback, scope binding, canonical invalidation, idle and SIGTERM passed", flush=True)
