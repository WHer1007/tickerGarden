"""Reward HTTP reads against the isolated finalized projection database."""
import json
import signal
import socket
import subprocess
import time
import urllib.request
import urllib.error
import urllib.parse


def run(root, env, sql, user, rpc):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    api_env = dict(env, TG_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"], TG_HTTP_ADDR=f"127.0.0.1:{port}", TG_TREASURY_PROOF_MANIFEST="")
    process = subprocess.Popen([str(root / "bin/api")], env=api_env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    origin = f"http://127.0.0.1:{port}"
    def get(path):
        try:
            with urllib.request.urlopen(origin + path, timeout=8) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                body = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise AssertionError(f"reward API returned non-JSON HTTP {error.code}") from exc
            return error.code, body
    try:
        for _ in range(50):
            try:
                if get("/livez")[0] == 200:
                    break
            except (urllib.error.URLError, ConnectionError):
                pass
            if process.poll() is not None:
                raise AssertionError("reward API exited")
            time.sleep(0.1)
        else:
            raise AssertionError("reward API did not start")
        path = "/v1/users/" + user + "/rewards"
        status, first = get(path + "?limit=1")
        assert status == 200, (status, first)
        assert len(first["items"]) == 1 and first["nextCursor"]
        assert first["source"]["observedClaimHistoryVerified"] is True and int(first["source"]["replayedInputCount"]) >= 3
        assert first["source"]["historyComplete"] is False and first["source"]["publicationEligible"] is False
        status, second = get(path + "?limit=1&cursor=" + urllib.parse.quote(first["nextCursor"]))
        assert status == 200 and len(second["items"]) == 1 and second["nextCursor"] is None
        assert first["source"] == second["source"]
        values = [first["items"][0]["value"], second["items"][0]["value"]]
        quote = next(v for v in values if v["assetKind"] == "quote")
        assert quote["unpaidAmount"] == "1" and quote["observedClaimedAmount"] == "14"
        assert quote["conversionStatus"] == "not_applicable" and quote["conversionCandidateAmount"] == "0"
        meme = next(v for v in values if v["assetKind"] == "meme")
        assert meme["conversionStatus"] == "not_graduated" and meme["conversionCandidateAmount"] == "0"
        assert all(v["beneficiary"] == user for v in values)
        assert all(v["positionUnlockAt"] == "0" and v["positionLockSatisfied"] is True for v in values)
        assert all(v["claimStatus"] == "candidate" and v["claimCandidateAmount"] == v["unpaidAmount"] for v in values)
        empty = get("/v1/users/0x" + "99" * 20 + "/rewards")
        assert empty[0] == 200 and empty[1]["items"] == []
        assert get(path + "?revision=0:0x" + "00" * 32)[0] == 400
        tip = first["source"]["blockHash"]
        digest = sql("SELECT digest FROM tickergarden.projection_observation_batches WHERE chain_id=46630 AND block_hash='" + tip + "'")
        middle = json.loads(sql("SELECT json_build_object('hash',b.hash,'parent',b.parent_hash,'time',b.block_timestamp) FROM tickergarden.chain_blocks b JOIN tickergarden.projection_checkpoints p ON p.chain_id=b.chain_id WHERE b.chain_id=46630 AND b.canonical AND b.number=p.start_block+1"))
        middle_where = " WHERE chain_id=46630 AND hash='"+middle["hash"]+"'"
        try:
            sql("UPDATE tickergarden.chain_blocks SET parent_hash='0x"+"00"*32+"'"+middle_where)
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.chain_blocks SET parent_hash='"+middle["parent"]+"'"+middle_where)
        try:
            sql("UPDATE tickergarden.chain_blocks SET block_timestamp=0"+middle_where)
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.chain_blocks SET block_timestamp="+str(middle["time"])+middle_where)
        input_record = json.loads(sql("SELECT json_build_object('hash',block_hash,'index',log_index,'digest',digest) FROM tickergarden.projection_inputs WHERE chain_id=46630 ORDER BY block_hash,log_index LIMIT 1"))
        where_input = " WHERE chain_id=46630 AND block_hash='" + input_record["hash"] + "' AND log_index=" + str(input_record["index"])
        try:
            sql("UPDATE tickergarden.projection_inputs SET digest='0x"+"00"*32+"'"+where_input)
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.projection_inputs SET digest='"+input_record["digest"]+"'"+where_input)
        try:
            sql("UPDATE tickergarden.projection_checkpoints SET input_count=input_count+1 WHERE chain_id=46630")
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.projection_checkpoints SET input_count=input_count-1 WHERE chain_id=46630")
        original_hex = sql("SELECT encode(payload,'hex') FROM tickergarden.projection_observation_batches WHERE chain_id=46630 AND block_hash='" + tip + "'")
        forged = json.loads(bytes.fromhex(original_hex))
        target = next(o for o in forged["observations"] if o["kind"] == "rewardPosition" and o["value"]["assetKind"] == "quote" and o["value"]["beneficiary"] == user)
        target["value"]["observedClaimedAmount"] = "999"
        changed_hex = json.dumps(forged,separators=(",",":")).encode().hex()
        changed_digest = rpc("web3_sha3",["0x"+changed_hex])
        try:
            sql("UPDATE tickergarden.projection_observation_batches SET payload=decode('"+changed_hex+"','hex'),digest='"+changed_digest+"' WHERE chain_id=46630 AND block_hash='"+tip+"'")
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.projection_observation_batches SET payload=decode('"+original_hex+"','hex'),digest='"+digest+"' WHERE chain_id=46630 AND block_hash='"+tip+"'")
        forged_claim = json.loads(bytes.fromhex(original_hex))
        target = next(o for o in forged_claim["observations"] if o["kind"] == "rewardPosition" and o["value"]["assetKind"] == "quote" and o["value"]["beneficiary"] == user)
        target["value"]["claimStatus"] = "position_locked"
        target["value"]["claimCandidateAmount"] = "0"
        claim_hex = json.dumps(forged_claim,separators=(",",":")).encode().hex()
        claim_digest = rpc("web3_sha3",["0x"+claim_hex])
        try:
            sql("UPDATE tickergarden.projection_observation_batches SET payload=decode('"+claim_hex+"','hex'),digest='"+claim_digest+"' WHERE chain_id=46630 AND block_hash='"+tip+"'")
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.projection_observation_batches SET payload=decode('"+original_hex+"','hex'),digest='"+digest+"' WHERE chain_id=46630 AND block_hash='"+tip+"'")
        forged_time = json.loads(bytes.fromhex(original_hex))
        for observation in forged_time["observations"]:
            value = observation["value"]
            if "observedAtTimestamp" in value:
                value["observedAtTimestamp"] = str(int(value["observedAtTimestamp"])+1)
        time_hex = json.dumps(forged_time,separators=(",",":")).encode().hex()
        time_digest = rpc("web3_sha3",["0x"+time_hex])
        try:
            sql("UPDATE tickergarden.projection_observation_batches SET payload=decode('"+time_hex+"','hex'),digest='"+time_digest+"' WHERE chain_id=46630 AND block_hash='"+tip+"'")
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.projection_observation_batches SET payload=decode('"+original_hex+"','hex'),digest='"+digest+"' WHERE chain_id=46630 AND block_hash='"+tip+"'")
        try:
            sql("UPDATE tickergarden.projection_observation_batches SET digest='0x" + "00" * 32 + "' WHERE chain_id=46630 AND block_hash='" + tip + "'")
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.projection_observation_batches SET digest='" + digest + "' WHERE chain_id=46630 AND block_hash='" + tip + "'")
        try:
            sql("UPDATE tickergarden.chain_blocks SET canonical=false WHERE chain_id=46630 AND hash='" + tip + "'")
            assert get(path)[0] == 503
        finally:
            sql("UPDATE tickergarden.chain_blocks SET canonical=true WHERE chain_id=46630 AND hash='" + tip + "'")
        assert get(path)[0] == 200
    finally:
        process.send_signal(signal.SIGTERM)
        _, errors = process.communicate(timeout=15)
        assert process.returncode == 0, errors.decode()
    cache_env = dict(env, TG_REWARDS_CACHE_TEST_DSN=env["TG_INDEXER_DATABASE_URL"], TG_REWARDS_CACHE_TEST_USER=user)
    subprocess.run(["go","test","./internal/rewards","-run","TestIsolatedRewardCache","-count=1","-v"], cwd=root, env=cache_env, check=True)
    print("Reward HTTP: paginated finalized views, wallet isolation, revision/digest/canonical rejection passed", flush=True)
