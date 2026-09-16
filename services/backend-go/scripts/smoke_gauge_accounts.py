"""Persistent Gauge accounts on an isolated synthetic EVM graph."""
import json
import subprocess
import time


def run(root, env, worker_env, discovery_env, rpc, sql):
    tx = rpc("eth_sendTransaction", [{"from": rpc("eth_accounts", [])[0], "to": "0x" + format(0x2002, "040x"), "data": "0xfeedface", "gas": "0x50000"}])
    receipt = None
    for _ in range(50):
        receipt = rpc("eth_getTransactionReceipt", [tx])
        if receipt:
            break
        time.sleep(0.1)
    assert receipt and receipt["status"] == "0x1"
    for _ in range(4):
        if int(rpc("eth_getBlockByNumber", ["finalized", False])["number"], 16) >= int(receipt["blockNumber"], 16):
            break
        rpc("anvil_mine", ["0x20"])
    else:
        raise AssertionError("Gauge event did not finalize")

    def catchup():
        for name, configuration in [("indexer", env), ("discovery-worker", discovery_env), ("projection-worker", worker_env)]:
            for _ in range(150):
                result = subprocess.run([str(root / "bin" / name), "--once"], env=configuration, capture_output=True, text=True, check=True)
                if json.loads(result.stdout)["action"] == "idle":
                    break
            else:
                raise AssertionError("Gauge account pipeline did not converge")
    catchup()
    count = int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='gaugePosition'"))
    assert count > 0
    assert sql("SELECT DISTINCT value->>'unpaidAmount' FROM tickergarden.canonical_block_observations WHERE kind='rewardPosition' AND value->>'beneficiaryType'='1' AND value->>'assetKind'='quote'") == "7"
    assert sql("SELECT DISTINCT value->>'observedClaimedAmount' FROM tickergarden.canonical_block_observations WHERE kind='rewardPosition' AND value->>'beneficiaryType'='1'") == "0"
    assert sql("SELECT DISTINCT value->>'quoteClaimable' FROM tickergarden.canonical_block_observations WHERE kind='gaugePosition'") == "7"
    assert sql("SELECT DISTINCT value->>'rawRewardExitAt' FROM tickergarden.canonical_block_observations WHERE kind='gaugePosition'") == "1"
    assert sql("SELECT bool_and((value->>'rawRewardExitReady')::boolean AND (value->>'observedAtTimestamp')::numeric >= 1) FROM tickergarden.canonical_block_observations WHERE kind='gaugePosition'") == "t"

    rpc("anvil_mine", ["0x20"])
    catchup()
    assert int(sql("SELECT count(*) FROM tickergarden.canonical_block_observations WHERE kind='gaugePosition'")) > count
    assert sql("SELECT value->>'knownStoredActiveSum' FROM tickergarden.canonical_block_observations WHERE kind='gauge' ORDER BY block_number DESC LIMIT 1") == "10"
    assert sql("SELECT value->>'fullReconciliation' FROM tickergarden.canonical_block_observations WHERE kind='gauge' ORDER BY block_number DESC LIMIT 1") == "false"
    # Deposit and allocate into this discovered staking market through actual logs.
    user = rpc("eth_accounts", [])[0]
    for selector in ["feedface", "feedbeef"]:
        tx = rpc("eth_sendTransaction", [{"from": user, "to": "0x" + format(0x3000, "040x"), "data": "0x" + selector, "gas": "0x50000"}])
        receipt = None
        for _ in range(50):
            receipt = rpc("eth_getTransactionReceipt", [tx])
            if receipt:
                break
            time.sleep(0.1)
        assert receipt and receipt["status"] == "0x1"
    for _ in range(4):
        if int(rpc("eth_getBlockByNumber", ["finalized", False])["number"], 16) >= int(receipt["blockNumber"], 16):
            break
        rpc("anvil_mine", ["0x20"])
    else:
        raise AssertionError("Vault allocation did not finalize")
    catchup()
    tip = sql("SELECT tip_hash FROM tickergarden.projection_checkpoints WHERE chain_id=46630")
    report = json.loads(subprocess.run([str(root / "bin/reconciliation-inspect"), "46630", tip], env=dict(env, TG_RECONCILIATION_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"]), capture_output=True, text=True, check=True).stdout)
    assert report["report"]["expected"] == 8 and report["report"]["completed"] == 8 and report["report"]["failed"] == 6
    market_probes = [p for p in report["report"]["probes"] if p["kind"] == "vaultMarket"]
    assert len(market_probes) == 1
    assert market_probes[0]["expected"] == "40" and market_probes[0]["actual"] == "60" and market_probes[0]["status"] == "mismatch"
    assert report["coverage"]["eventReplayVerified"] and not report["report"]["publicationEligible"]
    assert sql("SELECT expected_value||':'||actual_value||':'||status FROM tickergarden.canonical_reconciliation_probes WHERE block_hash='" + tip + "' AND kind='vaultMarket'") == "40:60:mismatch"
    print("Gauge/Vault: finalized user events, empty-block refresh, allocation market totals and independent report replay passed", flush=True)
