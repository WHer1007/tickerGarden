"""Cumulative claimed fees from synthetic EVM logs in an isolated DB."""
import json
import subprocess
import time


def run(root, env, worker_env, discovery_env, rpc, sql):
    user = rpc("eth_accounts", [])[0]
    for _ in range(2):
        tx = rpc("eth_sendTransaction", [{"from": user, "to": "0x" + format(0x1006, "040x"), "data": "0xfeedface", "gas": "0x50000"}])
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
        raise AssertionError("fee claim did not finalize")
    def catchup():
        for name, configuration in [("indexer", env), ("discovery-worker", discovery_env), ("projection-worker", worker_env)]:
            for _ in range(150):
                result = subprocess.run([str(root / "bin" / name), "--once"], env=configuration, capture_output=True, text=True)
                if result.returncode:
                    raise RuntimeError(f"{name} failed: {result.stderr} {result.stdout}")
                if json.loads(result.stdout)["action"] == "idle":
                    break
            else:
                raise AssertionError("fee claims did not converge")
    catchup()
    assert sql("SELECT count(*) FROM tickergarden.canonical_projection_rows WHERE table_name='feeClaims'") == "2"
    assert sql("SELECT count(*) FROM tickergarden.canonical_projection_rows WHERE table_name='feeClaimTotals'") == "1"
    total = json.loads(sql("SELECT payload FROM tickergarden.canonical_projection_rows WHERE table_name='feeClaimTotals'"))
    assert total["values"]["claimedAmount"] == "14" and total["values"]["claimCount"] == "2"
    assert sql("SELECT count(*) FROM tickergarden.user_activity_records r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE b.canonical AND r.payload->>'signature' LIKE 'FeeClaimed(%' AND r.account='" + total["values"]["beneficiary"] + "' AND r.payload->'roles'->>0='beneficiary'") == "2"
    assert total["values"]["beneficiaryEpoch"] == "1" and total["values"]["beneficiaryType"] == "0"
    assert not total["values"]["historyComplete"]
    reward_query = "SELECT value FROM tickergarden.canonical_block_observations WHERE kind='rewardPosition' AND observation_key='" + total["key"] + "' ORDER BY block_number DESC LIMIT 1"
    reward = json.loads(sql(reward_query))
    assert reward["observedClaimedAmount"] == "14" and reward["observedClaimCount"] == "2"
    assert reward["unpaidAmount"] == "1" and reward["assetKind"] == "quote"
    assert reward["beneficiaryEpoch"] == "1" and reward["beneficiaryType"] == "0"
    assert reward["historyComplete"] is False and reward["publicationEligible"] is False
    rpc("anvil_mine", ["0x20"])
    catchup()
    refreshed = json.loads(sql(reward_query))
    assert refreshed["observedClaimedAmount"] == "14" and refreshed["unpaidAmount"] == "1"
    assert int(refreshed["observedAtTimestamp"]) >= int(reward["observedAtTimestamp"])
    assert json.loads(sql("SELECT payload FROM tickergarden.canonical_projection_rows WHERE table_name='feeClaimTotals'")) == total
    import smoke_reward_api
    smoke_reward_api.run(root, env, sql, total["values"]["beneficiary"], rpc)
    conversion_tx = rpc("eth_sendTransaction", [{"from":user,"to":"0x"+format(0x1006,"040x"),"data":"0xfeedcafe","gas":"0x80000"}])
    converted = None
    for _ in range(50):
        converted = rpc("eth_getTransactionReceipt", [conversion_tx])
        if converted: break
        time.sleep(0.1)
    assert converted and converted["status"] == "0x1" and len(converted["logs"]) == 2
    for _ in range(4):
        if int(rpc("eth_getBlockByNumber", ["finalized",False])["number"],16) >= int(converted["blockNumber"],16): break
        rpc("anvil_mine",["0x20"])
    else: raise AssertionError("conversion did not finalize")
    catchup()
    conversion = json.loads(sql("SELECT value FROM tickergarden.canonical_block_observations WHERE kind='rewardConversionBatch'"))
    assert conversion["memeSpent"] == "7" and conversion["quoteReceived"] == "11" and conversion["itemCount"] == "1"
    assert conversion["items"][0]["user"] == total["values"]["beneficiary"] and conversion["items"][0]["creatorEpoch"] == "1"
    assert conversion["itemTotalsMatch"] is True and conversion["publicationEligible"] is False
    rpc("anvil_mine",["0x20"])
    catchup()
    assert json.loads(sql("SELECT value FROM tickergarden.canonical_block_observations WHERE kind='rewardConversionBatch'")) == conversion
    assert json.loads(sql("SELECT payload FROM tickergarden.canonical_projection_rows WHERE table_name='feeClaimTotals'")) == total
    print("Conversion batches: receipt-backed item totals, persisted attribution, restart and no claimed-fee double counting passed", flush=True)
    print("Fee claims: authenticated logs, epoch-isolated cumulative totals, restart and empty-block stability passed", flush=True)
