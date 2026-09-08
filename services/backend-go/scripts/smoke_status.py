"""Read-only operational status against an isolated pipeline database."""
import json
import subprocess


def run(root, env, sql, rpc):
    status_env = dict(env, TG_STATUS_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"], TG_CHAIN_ID="46630", TG_STATUS_MAX_LAG_BLOCKS="0", TG_STATUS_MAX_PROGRESS_AGE="15m", TG_STATUS_RPC_URL="")
    command = [str(root / "bin/backend-status"), "--once"]
    def inspect():
        result = subprocess.run(command, env=status_env, capture_output=True, text=True)
        assert result.returncode == 2 and not result.stderr, result.stderr
        body = json.loads(result.stdout)
        assert not body["productionReadinessVerified"]
        return body
    status = inspect()
    assert status["principalFailed"] == 4 and "principal_checks_failed" in status["alerts"]
    assert "journal_ahead_of_source" not in status["alerts"]
    assert [s["name"] for s in status["stages"]] == ["journal", "discovery", "projection", "publication"]
    for stage in status["stages"][:3]:
        assert stage["canonical"] and stage["lagBlocks"] == "0", stage
    rpc_env = dict(status_env, TG_STATUS_RPC_URL=env["TG_RPC_URL"])
    result = subprocess.run(command, env=rpc_env, capture_output=True, text=True)
    assert result.returncode == 2 and not result.stderr, result.stderr
    observed = json.loads(result.stdout)
    assert observed["rpc"]["identityVerified"] and observed["rpc"]["storedFinalizedHashMatches"]
    assert observed["rpc"]["journalLagBlocks"] == "0"
    rpc("anvil_mine", ["0x2"])
    result = subprocess.run(command, env=rpc_env, capture_output=True, text=True)
    assert result.returncode == 2, result.stderr
    behind = json.loads(result.stdout)
    assert int(behind["rpc"]["journalLagBlocks"]) >= 2 and "rpc_journal_backlog" in behind["alerts"]
    assert behind["stages"] == status["stages"]  # monitoring did not move any cursor
    genesis = sql("SELECT genesis_hash FROM tickergarden.chain_journal WHERE chain_id=46630")
    sql("UPDATE tickergarden.chain_journal SET genesis_hash='0x" + "f" * 64 + "' WHERE chain_id=46630")
    result = subprocess.run(command, env=rpc_env, capture_output=True, text=True)
    assert result.returncode == 1 and not result.stdout
    sql("UPDATE tickergarden.chain_journal SET genesis_hash='" + genesis + "' WHERE chain_id=46630")
    result = subprocess.run(command, env=dict(rpc_env, TG_STATUS_RPC_URL="http://127.0.0.1:1/private-rpc-sentinel"), capture_output=True, text=True)
    assert result.returncode == 1 and not result.stdout and "sentinel" not in result.stderr
    saved_progress = sql("SELECT updated_at FROM tickergarden.chain_journal WHERE chain_id=46630")
    sql("UPDATE tickergarden.chain_journal SET updated_at=now()-interval '1 hour' WHERE chain_id=46630")
    assert "journal_progress_stale" in inspect()["alerts"]
    sql("UPDATE tickergarden.chain_journal SET updated_at='" + saved_progress + "' WHERE chain_id=46630")
    saved_hash = sql("SELECT manifest_hash FROM tickergarden.projection_checkpoints WHERE chain_id=46630")
    sql("UPDATE tickergarden.projection_checkpoints SET manifest_hash='0x" + "f" * 64 + "' WHERE chain_id=46630")
    assert "projection_manifest_mismatch" in inspect()["alerts"]
    sql("UPDATE tickergarden.projection_checkpoints SET manifest_hash='" + saved_hash + "' WHERE chain_id=46630")
    tip = sql("SELECT tip_hash FROM tickergarden.projection_checkpoints WHERE chain_id=46630")
    sql("UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=46630 AND hash='" + tip + "'")
    bad = inspect()
    assert "projection_noncanonical" in bad["alerts"] and "principal_report_missing" in bad["alerts"]
    sql("UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=46630 AND hash='" + tip + "'")
    missing_env = dict(status_env, TG_CHAIN_ID="421614")
    result = subprocess.run(command, env=missing_env, capture_output=True, text=True)
    assert result.returncode == 2 and "finalized_reference_missing" in json.loads(result.stdout)["alerts"]
    invalid_env = dict(status_env, TG_STATUS_DATABASE_URL="invalid-private-connection-sentinel")
    result = subprocess.run(command, env=invalid_env, capture_output=True, text=True)
    assert result.returncode == 1 and not result.stdout and "sentinel" not in result.stderr
    print("Operations status: DB signals, live RPC backlog/identity checks, failure exit codes and unchanged cursors passed", flush=True)
