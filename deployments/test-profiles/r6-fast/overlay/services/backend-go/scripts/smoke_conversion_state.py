"""Read-only conversion CLI over synthetic Anvil getters, restored after checks."""
import hashlib
import json
from pathlib import Path
import subprocess
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from smoke_bindings import getter_runtime


def run(root, data, env, rpc, manifest, registry, state, token, creator, sender, user, staking):
    sender = rpc("eth_accounts", [])[8]  # Separate settlement and maintenance senders.
    snapshot = rpc("evm_snapshot", [])
    selector = lambda sig: rpc("web3_sha3", ["0x" + sig.encode().hex()])[2:10]
    word = lambda address: bytes.fromhex("00" * 12 + address[2:])
    uint = lambda n: n.to_bytes(32, "big")
    roots = {c["module"]: c["address"] for c in manifest["contracts"]}
    try:
        graduated = list(state)
        # The reward path uses the canonical pool directly, without router/quoter.
        pool_key = registry[selector("canonicalPoolKey(bytes32)")]
        pool_id = rpc("web3_sha3", ["0x" + pool_key.hex()])
        graduated[17], graduated[18], graduated[19] = pool_id[2:], format(2, "064x"), format(1, "064x")
        registry = dict(registry)
        hook = "0x" + state[13][-40:]
        manager = "0x" + format(0x6000, "040x")
        manager_code = "0x6004355460005260206000f3"
        storage_slot = rpc("web3_sha3", [pool_id + format(6, "064x")])
        liquidity_slot = "0x" + format(int(storage_slot, 16) + 3, "064x")
        rpc("anvil_setCode", [manager, manager_code])
        rpc("anvil_setStorageAt", [manager, storage_slot, "0x"+format(1 << 96, "064x")])
        rpc("anvil_setStorageAt", [manager, liquidity_slot, "0x"+format(1000, "064x")])
        manager_pin = dict(address=manager, runtimeCodeHash=rpc("web3_sha3", [manager_code]))
        registry[selector("activeFeeSource(bytes32)")] = word(hook) + uint(2)
        hook_code = getter_runtime({selector("marketRegistry()"): word(roots["MarketRegistryV1"]), selector("protocolFeeVault()"): word(roots["ProtocolFeeVault"]), selector("poolManager()"): word(manager), selector("hookPermissionMask()"): uint(0x2044), selector("poolBinding(bytes32)"): bytes.fromhex("11"*32 + pool_id[2:]) + uint(2) + uint(1) + uint(3)})
        rpc("anvil_setCode", [hook, hook_code])
        registry[selector("market(bytes32)")] = bytes.fromhex("".join(graduated))
        rpc("anvil_setCode", [roots["MarketRegistryV1"], getter_runtime(registry)])
        rpc("anvil_setCode", [token, getter_runtime({selector("marketId()"): bytes.fromhex("11"*32), selector("factory()"): word(roots["TickerGardenFactoryV1"]), selector("balanceOf(address)"): uint(200)})])
        vault = {selector("marketRegistry()"): word(roots["MarketRegistryV1"]), selector("creatorRevenueRegistry()"): word(creator), selector("feePolicyId()"): bytes.fromhex(state[4]), selector("settlementOperator()"): word(sender), selector("rawRewardExitAt(bytes32,address)"): uint(0), selector("creatorLiability(bytes32,uint32,address)"): uint(13)}
        conversion_selector = selector("settleRewards(bytes32,(address,uint32,uint256)[],uint256,uint256)")
        vault[selector("totalLiability(address)")] = uint(100)
        rpc("anvil_setBalance", [roots["ProtocolFeeVault"], hex(200)])
        vault[selector("poolManager()")] = word(manager)
        vault[conversion_selector] = uint(7) + uint(100)
        rpc("anvil_setCode", [roots["ProtocolFeeVault"], getter_runtime(vault)])
        contracts = manifest["contracts"] + [dict(module="CreatorRevenueRegistry", address=creator), dict(module="TickerGardenMemeHook", address=hook)]
        observed_manifest = dict(manifest, contracts=[dict(c, runtimeCodeHash=rpc("web3_sha3", [rpc("eth_getCode", [c["address"], "latest"])])) for c in contracts])
        path = data / "conversion-observation-manifest.json"
        path.write_text(json.dumps(observed_manifest))
        input_path = data / "conversion-observation-input.json"
        body = dict(operator=sender, marketId="0x"+"11"*32, participants=[dict(user=user, creatorEpoch=0), dict(user=user, creatorEpoch=1)])
        input_path.write_text(json.dumps(body))
        command = [str(root / "bin/settlement-worker"), "--observe-state", str(input_path), "--manifest", str(path)]
        rpc("anvil_mine", ["0x1"])
        nonce = rpc("eth_getTransactionCount", [sender, "latest"])
        result = subprocess.run(command, env=env, text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        result = json.loads(result.stdout)
        assert result["stateObserved"] and not result["transactionSubmission"] and not result["priceReferenceVerified"] and not result["solvencyVerified"]
        staker, creator_row = result["state"]["participants"]
        assert creator_row["eligible"] and creator_row["availableMeme"] == "13"
        assert staker["eligible"] == staking and staker["availableMeme"] == ("9" if staking else "0")
        if not staking:
            assert staker["reason"] == "staking_disabled"
        # Live request and plan independently re-read authenticated state.
        planning = dict(poolManager=manager_pin, operator=sender, marketId=body["marketId"], participants=[dict(user=user, creatorEpoch=0, maximumMeme="20"), dict(user=user, creatorEpoch=1, maximumMeme="11")], perBatchCap="100", totalMeme="100", deadline=int(time.time())+120, slippageBps=100)
        input_path.write_text(json.dumps(planning))
        request_command = [str(root / "bin/settlement-worker"), "--observed-request", str(input_path), "--manifest", str(path)]
        response = subprocess.run(request_command, env=env, text=True, capture_output=True)
        assert response.returncode == 0, response.stderr
        candidate = json.loads(response.stdout)
        request = candidate["candidate"]["request"]
        assert candidate["candidateOnly"] and candidate["stateObserved"] and not candidate["transactionSubmission"]
        assert request["totalMeme"] == ("20" if staking else "11")
        assert request["items"][-1]["maximumMeme"] == "11"
        if staking:
            assert request["items"][0]["maximumMeme"] == "9"
        planning["quote"] = dict(chainId=46630, marketId=body["marketId"], requestDigest=request["requestDigest"], quotedAt=int(time.time()), referenceId="synthetic-bound-quote", expectedOutput="100")
        input_path.write_text(json.dumps(planning))
        plan_command = list(request_command)
        plan_command[1] = "--observed-plan"
        response = subprocess.run(plan_command, env=env, text=True, capture_output=True)
        assert response.returncode == 0, response.stderr
        planned = json.loads(response.stdout)
        assert planned["candidate"]["plan"]["minimumQuote"] == "99"
        assert planned["candidate"]["plan"]["requestDigest"] == request["requestDigest"]
        assert not planned["priceReferenceVerified"] and not planned["solvencyVerified"]
        preview_command = list(plan_command)
        preview_command[1] = "--preview"
        response = subprocess.run(preview_command, env=env, text=True, capture_output=True)
        assert response.returncode == 0, response.stderr
        simulated = json.loads(response.stdout)
        assert simulated["status"] == "simulated_unsigned" and simulated["hypotheticalAllocations"] and not simulated["executionComplete"] and not simulated["transactionSubmission"]
        preview = simulated["preview"]
        assert preview["from"] == sender and preview["to"] == roots["ProtocolFeeVault"] and preview["value"] == "0x0"
        assert preview["route"]["poolId"] == pool_id and preview["route"]["hook"] == hook and preview["route"]["poolManager"] == manager_pin
        coverage = preview["assetCoverage"]
        assert len(coverage) == 2 and coverage[0]["asset"] == token and coverage[1]["asset"] == "0x" + "00"*20
        assert all(x["balance"] == "200" and x["totalLiability"] == "100" and x["surplus"] == "100" for x in coverage)
        observed_pool = preview["route"]["poolState"]
        assert observed_pool["stateSlot"] == storage_slot and observed_pool["sqrtPriceX96"] == str(1 << 96) and observed_pool["activeLiquidity"] == "1000"
        assert observed_pool["tick"] == 0 and observed_pool["protocolFee"] == 0 and observed_pool["lpFee"] == 0
        assert preview["spent"] == "7" and preview["received"] == "100"
        assert sum(int(x["memeSpent"]) for x in preview["allocations"]) == 7
        assert sum(int(x["quoteReceived"]) for x in preview["allocations"]) == 100
        assert sum(int(x["memeRefund"]) for x in preview["allocations"]) == int(request["totalMeme"]) - 7
        abi_check = subprocess.run(["node", str(root / "scripts/verify_settlement_calldata.mjs")], input=json.dumps(preview), env=env, text=True, capture_output=True)
        assert abi_check.returncode == 0, abi_check.stderr
        fixture = subprocess.run(["node", str(root / "scripts/create_reference_fixture.mjs")], input=json.dumps(preview), env=env, text=True, capture_output=True)
        assert fixture.returncode == 0, fixture.stderr
        fixture = json.loads(fixture.stdout)
        policy_path = data / "conversion-reference-policy.json"
        policy_path.write_text(json.dumps(fixture["policy"]))
        planning["references"] = fixture["references"]
        input_path.write_text(json.dumps(planning))
        reference_command = list(preview_command)
        reference_command[1] = "--reference-check"
        reference_env = dict(env, TG_SETTLEMENT_REFERENCE_POLICY=str(policy_path), TG_SETTLEMENT_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"])
        checked = subprocess.run(reference_command, env=reference_env, text=True, capture_output=True)
        assert checked.returncode == 0, checked.stderr
        checked = json.loads(checked.stdout)
        assert checked["referenceSignaturesVerified"] and checked["simulationPriceWithinPolicy"] and not checked["providerIndependenceVerified"] and not checked["transactionSubmission"]
        assert checked["referenceCheck"]["minimumReceived"] == "99"
        provider_hits = []
        class ReferenceProvider(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                index = int(self.path.removeprefix("/"))
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                expected = fixture["references"][index]["price"]
                assert request["version"] == "tickergarden-conversion-reference-request-v1"
                assert set(request) == {"version", "chainId", "genesisHash", "marketId", "memeToken", "quoteAsset", "requestDigest"}
                assert all(request[k] == expected[k] for k in request if k != "version")
                provider_hits.append(index)
                raw = json.dumps(fixture["references"][index]).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        providers = ThreadingHTTPServer(("127.0.0.1", 0), ReferenceProvider)
        provider_worker = threading.Thread(target=providers.serve_forever, daemon=True)
        provider_worker.start()
        saved_refs = planning.pop("references")
        try:
            fixture["policy"]["allowLoopbackHttp"] = True
            for i, source in enumerate(fixture["policy"]["sources"]):
                source["endpoint"] = f"http://127.0.0.1:{providers.server_port}/{i}"
            policy_path.write_text(json.dumps(fixture["policy"]))
            input_path.write_text(json.dumps(planning))
            fetch_command = list(reference_command)
            fetch_command[1] = "--fetch-reference-check"
            evidence_dir = data / "conversion-evidence"
            evidence_dir.mkdir()
            fetch_command += ["--record", "--evidence-dir", str(evidence_dir)]
            fetched = subprocess.run(fetch_command, env=reference_env, text=True, capture_output=True)
            assert fetched.returncode == 0, fetched.stderr
            fetched = json.loads(fetched.stdout)
            assert fetched["referenceSignaturesVerified"] and fetched["simulationPriceWithinPolicy"] and not fetched["transactionSubmission"]
            assert sorted(provider_hits) == [0, 1]
            evidence = fetched.pop("evidence")
            evidence_bytes = Path(evidence["path"]).read_bytes()
            assert hashlib.sha256(evidence_bytes).hexdigest() == evidence["sha256"]
            persisted = json.loads(evidence_bytes)
            assert persisted["version"] == "tickergarden-conversion-evidence-v1"
            assert persisted["result"] == fetched
            assert persisted["manifest"] == json.loads(path.read_text())
            assert fetched["record"]["status"] == "checked_unsigned"
            assert fetched["record"]["sequence"] > 0
            # Observe both eth_call minima through a forwarding RPC fixture.
            auto_mode = ["success"]
            minima = []
            latest_reads = [0]
            pending_reads = [0]
            submitted_raw = []
            class QuoteProxy(BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass
                def do_POST(self):
                    req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    method, params = req["method"], req["params"]
                    if method == "eth_getBlockByNumber" and params[0] == "latest":
                        latest_reads[0] += 1
                    if method == "eth_sendRawTransaction":
                        submitted_raw.append(params[0])
                    value = rpc(method, params)
                    if method == "eth_sendRawTransaction" and staking:
                        # Anvil accepted the bytes, but this connection loses the acknowledgement.
                        self.close_connection = True
                        return
                    if auto_mode[0] == "insufficient-gas" and method == "eth_getBalance" and params[0] == sender:
                        value = "0x1"
                    if auto_mode[0] == "nonce-moved" and method == "eth_getTransactionCount" and params[1] == "pending":
                        pending_reads[0] += 1
                        if pending_reads[0] == 2:
                            value = hex(int(value, 16) + 1)
                    data_hex = params[0].get("data", "") if method == "eth_call" else ""
                    if data_hex.startswith("0x" + conversion_selector):
                        minima.append(int(data_hex[10+64*2:10+64*3], 16))
                        if auto_mode[0] == "intent-changed" and "nonce" in params[0]:
                            value = "0x" + (uint(8) + uint(100)).hex()
                        if auto_mode[0] == "probe-zero" and len(minima) == 1:
                            value = "0x" + (uint(0) + uint(100)).hex()
                        if auto_mode[0] == "second-low" and len(minima) == 2:
                            value = "0x" + (uint(7) + uint(98)).hex()
                    if auto_mode[0] == "changed-candidate" and latest_reads[0] >= 2 and data_hex.startswith("0x" + selector("creatorLiability(bytes32,uint32,address)")):
                        value = "0x" + uint(8).hex()
                    raw = json.dumps(dict(jsonrpc="2.0", id=req["id"], result=value)).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
            quote_proxy = ThreadingHTTPServer(("127.0.0.1", 0), QuoteProxy)
            quote_thread = threading.Thread(target=quote_proxy.serve_forever, daemon=True)
            quote_thread.start()
            auto_command = list(reference_command)
            auto_command[1] = "--auto-reference-check"
            original_quote = planning.pop("quote")
            input_path.write_text(json.dumps(planning))
            try:
                auto_env = dict(reference_env, TG_RPC_URL=f"http://127.0.0.1:{quote_proxy.server_port}")
                quote_command = list(reference_command)
                quote_command[1] = "--quote"
                quoted = subprocess.run(quote_command, env=auto_env, text=True, capture_output=True)
                assert quoted.returncode == 0, quoted.stderr
                quoted = json.loads(quoted.stdout)
                assert quoted["candidateOnly"] and not quoted["priceReferenceVerified"] and not quoted["transactionSubmission"]
                assert quoted["quoteObservation"]["quote"]["expectedOutput"] == "100" and minima == [1]
                minima.clear()
                latest_reads[0] = 0
                automatic = subprocess.run(auto_command, env=auto_env, text=True, capture_output=True)
                assert automatic.returncode == 0, automatic.stderr
                automatic = json.loads(automatic.stdout)
                assert minima == [1, 99], minima
                assert automatic["quoteAutomaticallyObserved"] and automatic["referenceSignaturesVerified"] and not automatic["transactionSubmission"]
                assert automatic["quoteObservation"]["quote"]["expectedOutput"] == "100"
                assert automatic["quoteObservation"]["spent"] == "7"
                assert automatic["preview"]["candidate"]["plan"]["minimumQuote"] == "99"
                assert sorted(provider_hits) == [0, 0, 1, 1]
                before_hits = len(provider_hits)
                for mode, expected_minima in [("probe-zero", [1]), ("second-low", [1, 99]), ("changed-candidate", [1])]:
                    auto_mode[0] = mode
                    minima.clear()
                    latest_reads[0] = 0
                    failed = subprocess.run(auto_command, env=auto_env, text=True, capture_output=True)
                    assert failed.returncode != 0 and not failed.stdout, (mode, failed.stdout, failed.stderr)
                    assert minima == expected_minima, (mode, minima)
                    assert len(provider_hits) == before_hits
                planning["quote"] = original_quote
                input_path.write_text(json.dumps(planning))
                minima.clear()
                failed = subprocess.run(auto_command, env=auto_env, text=True, capture_output=True)
                assert failed.returncode != 0 and not failed.stdout and not minima
                work_selection = dict(planning)
                work_selection.pop("quote")
                work_selection["deadline"] = 0
                work_input = data / "conversion-work.json"
                work_input.write_text(json.dumps(dict(runId="smoke-cycle", deadlineSeconds=120, selection=work_selection)))
                enqueue_command = [str(root / "bin/settlement-worker"), "--enqueue", str(work_input), "--manifest", str(path)]
                enqueued = subprocess.run(enqueue_command, env=reference_env, text=True, capture_output=True)
                assert enqueued.returncode == 0, enqueued.stderr
                queued = json.loads(enqueued.stdout)["work"]
                assert queued["status"] == "queued"
                scope_path = data / "conversion-work-scope.json"
                scope_path.write_text(json.dumps(dict(chainId=fixture["policy"]["chainId"], genesisHash=fixture["policy"]["genesisHash"], operator=sender)))
                work_command = [str(root / "bin/settlement-worker"), "--work-once", str(scope_path)]
                worked = subprocess.run(work_command, env=reference_env, text=True, capture_output=True)
                assert worked.returncode == 0, worked.stderr
                worked = json.loads(worked.stdout)
                assert worked["work"]["status"] == "checked_unsigned" and not worked["transactionSubmission"]
                assert worked["work"]["jobKey"] == queued["jobKey"]
                completed_sequence = worked["work"]["checkSequence"]
                idle = subprocess.run(work_command, env=reference_env, text=True, capture_output=True)
                assert idle.returncode == 0 and json.loads(idle.stdout)["work"]["status"] == "idle", idle.stderr
                duplicate = subprocess.run(enqueue_command, env=reference_env, text=True, capture_output=True)
                assert duplicate.returncode == 0 and json.loads(duplicate.stdout)["work"] == worked["work"], duplicate.stderr
                run_command = list(work_command)
                run_command[1] = "--work-run"
                running = subprocess.Popen(run_command, env=reference_env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    time.sleep(0.5)
                    assert running.poll() is None
                    running.terminate()
                    run_stdout, run_stderr = running.communicate(timeout=10)
                    assert running.returncode == 0 and json.loads(run_stdout.splitlines()[0])["work"]["status"] == "idle", run_stderr
                finally:
                    if running.poll() is None:
                        running.kill()
                        running.wait(timeout=5)
                fee_path = data / "conversion-execution-policy.json"
                fee_policy = dict(gasLimit="1000000", maxFeePerGas="10000000000", maxPriorityFeePerGas="1000000000", maximumGasCost="10000000000000000")
                fee_path.write_text(json.dumps(fee_policy))
                intent_path = data / "conversion-intent.json"
                intent_path.write_text(json.dumps(dict(chainId=fixture["policy"]["chainId"], genesisHash=fixture["policy"]["genesisHash"], operator=sender, jobKey=queued["jobKey"])))
                intent_command = [str(root / "bin/settlement-worker"), "--prepare-intent", str(intent_path)]
                intent_env = dict(auto_env, TG_SETTLEMENT_EXECUTION_POLICY=str(fee_path))
                auto_mode[0] = "intent-changed"
                minima.clear()
                latest_reads[0] = 0
                failed_intent = subprocess.run(intent_command, env=intent_env, text=True, capture_output=True)
                assert failed_intent.returncode != 0 and not failed_intent.stdout, failed_intent.stderr
                assert minima == [1, 99, 99], minima
                for mode, expected in [("insufficient-gas", [1, 99]), ("nonce-moved", [1, 99, 99])]:
                    auto_mode[0] = mode
                    minima.clear()
                    latest_reads[0] = 0
                    pending_reads[0] = 0
                    rejected = subprocess.run(intent_command, env=intent_env, text=True, capture_output=True)
                    assert rejected.returncode != 0 and not rejected.stdout, (mode, rejected.stderr)
                    assert minima == expected, (mode, minima)
                auto_mode[0] = "success"
                minima.clear()
                latest_reads[0] = 0
                time.sleep(1.1)  # Ensure a distinct fresh observation from the queued check.
                prepared = subprocess.run(intent_command, env=intent_env, text=True, capture_output=True)
                assert prepared.returncode == 0, prepared.stderr
                prepared = json.loads(prepared.stdout)
                assert minima == [1, 99, 99] and not prepared["reused"] and not prepared["transactionSubmission"]
                intent = prepared["record"]["intent"]
                assert intent["call"]["from"] == sender and intent["call"]["value"] == "0x0"
                assert intent["call"]["gas"] == hex(1000000) and intent["maximumGasCost"] == fee_policy["maximumGasCost"]
                assert int(intent["nonce"]) == int(nonce, 16)
                prepared_sequence = intent["checkSequence"]
                minima.clear()
                repeated = subprocess.run(intent_command, env=intent_env, text=True, capture_output=True)
                assert repeated.returncode == 0, repeated.stderr
                repeated = json.loads(repeated.stdout)
                assert repeated["reused"] and repeated["auditOnly"] and repeated["record"] == prepared["record"] and not minima
                read_command = list(intent_command)
                read_command[1] = "--intent"
                read_intent = subprocess.run(read_command, env=reference_env, text=True, capture_output=True)
                assert read_intent.returncode == 0 and json.loads(read_intent.stdout)["record"] == prepared["record"], read_intent.stderr
                fee_policy["maxPriorityFeePerGas"] = "0"
                fee_path.write_text(json.dumps(fee_policy))
                changed_fee = subprocess.run(intent_command, env=intent_env, text=True, capture_output=True)
                assert changed_fee.returncode != 0 and not changed_fee.stdout and not minima
                fee_path.write_text(json.dumps(intent["fees"]))
                signing_call = dict(intent["call"], type="0x2", chainId=hex(intent["chainId"]))
                signed_response = rpc("eth_signTransaction", [signing_call])
                signed_hex = signed_response["raw"] if isinstance(signed_response, dict) else signed_response
                signer_path = data / "conversion-test-signer.py"
                signer_counter = data / "conversion-signer-count.txt"
                signer_path.write_text("#!/usr/bin/env python3\nimport sys,json,hashlib\nfrom pathlib import Path\nr=json.load(sys.stdin)\nassert r['version']=='settlement-sign-v1'\nassert r['requestId']==" + repr(prepared["record"]["digest"]) + "\nassert hashlib.sha256(r['evidenceJson'].encode()).hexdigest()==r['checkDigest']\nwith Path(" + repr(str(signer_counter)) + ").open('a') as f: f.write('called\\n')\nprint(" + repr(signed_hex) + ")\n")
                signer_path.chmod(0o700)
                sign_command = [str(root / "bin/settlement-worker"), "--sign", str(intent_path)]
                sign_env = dict(intent_env, TG_SETTLEMENT_SIGNER_COMMAND=str(signer_path))
                auto_mode[0] = "intent-changed"
                minima.clear()
                refused_sign = subprocess.run(sign_command, env=sign_env, text=True, capture_output=True)
                assert refused_sign.returncode != 0 and not refused_sign.stdout and not signer_counter.exists(), refused_sign.stderr
                assert minima == [99, 99], minima
                auto_mode[0] = "success"
                minima.clear()
                signed = subprocess.run(sign_command, env=sign_env, text=True, capture_output=True)
                assert signed.returncode == 0, signed.stderr
                signed = json.loads(signed.stdout)
                assert signed["signing"]["status"] == "signed_stored" and not signed["transactionSubmission"], signed
                assert minima == [99, 99] and signer_counter.read_text().splitlines() == ["called"]
                assert signed["signing"]["transaction"]["rawTransaction"] == signed_hex
                signed_again = subprocess.run(sign_command, env=sign_env, text=True, capture_output=True)
                assert signed_again.returncode == 0 and json.loads(signed_again.stdout) == signed and signer_counter.read_text().splitlines() == ["called"], signed_again.stderr
                read_sign_command = list(sign_command)
                read_sign_command[1] = "--signed"
                signed_read = subprocess.run(read_sign_command, env=reference_env, text=True, capture_output=True)
                assert signed_read.returncode == 0 and json.loads(signed_read.stdout) == signed, signed_read.stderr
                submit_path = data / "conversion-submit.json"
                submit_input = json.loads(intent_path.read_text())
                submit_input["expectedTransactionHash"] = signed["signing"]["transaction"]["transactionHash"]
                submit_path.write_text(json.dumps(submit_input))
                submit_command = [str(root / "bin/settlement-worker"), "--submit", str(submit_path)]
                auto_mode[0] = "intent-changed"
                minima.clear()
                refused_submit = subprocess.run(submit_command, env=intent_env, text=True, capture_output=True)
                assert refused_submit.returncode != 0 and not refused_submit.stdout and not submitted_raw
                assert minima == [99,99], minima
                auto_mode[0] = "success"
                minima.clear()
                sent = subprocess.run(submit_command, env=intent_env, text=True, capture_output=True)
                assert sent.returncode == 0, sent.stderr
                sent = json.loads(sent.stdout)
                assert sent["submission"]["status"] == ("submission_unknown" if staking else "acknowledged") and not sent["executionComplete"], sent
                assert submitted_raw == [signed_hex] and minima == [99,99]
                minima.clear()
                retry = subprocess.run(submit_command, env=intent_env, text=True, capture_output=True)
                assert retry.returncode == 0 and json.loads(retry.stdout) == sent and not minima and submitted_raw == [signed_hex], retry.stderr
                read_submission = subprocess.run([str(root / "bin/settlement-worker"), "--submission", str(intent_path)], env=reference_env, text=True, capture_output=True)
                assert read_submission.returncode == 0 and json.loads(read_submission.stdout)["submission"] == sent["submission"], read_submission.stderr
                local_receipt = rpc("eth_getTransactionReceipt", [submit_input["expectedTransactionHash"]])
                assert local_receipt and local_receipt["status"] == "0x1"
                print("Conversion submission: local receipt, single send, fresh rejection and " + sent["submission"]["status"] + " recovery passed", flush=True)

            finally:
                quote_proxy.shutdown()
                quote_proxy.server_close()
                quote_thread.join(timeout=5)
                planning["quote"] = original_quote
                input_path.write_text(json.dumps(planning))
        finally:
            providers.shutdown()
            providers.server_close()
            provider_worker.join(timeout=5)
            planning["references"] = saved_refs
            input_path.write_text(json.dumps(planning))
        original_signature = planning["references"][0]["signature"]
        planning["references"][0]["signature"] = "AAAA"
        input_path.write_text(json.dumps(planning))
        before_evidence = sorted(evidence_dir.iterdir())
        invalid = subprocess.run(reference_command + ["--record", "--evidence-dir", str(evidence_dir)], env=reference_env, text=True, capture_output=True)
        assert invalid.returncode != 0 and not invalid.stdout and "reference check failed" in invalid.stderr
        assert sorted(evidence_dir.iterdir()) == before_evidence
        planning["references"][0]["signature"] = original_signature
        input_path.write_text(json.dumps(planning))
        planning["poolManager"] = dict(address=manager, runtimeCodeHash="0x" + "fe"*32)
        input_path.write_text(json.dumps(planning))
        bad_route = subprocess.run(preview_command, env=env, text=True, capture_output=True)
        assert bad_route.returncode != 0 and not bad_route.stdout and "reward conversion route unavailable" in bad_route.stderr
        planning["poolManager"] = manager_pin
        input_path.write_text(json.dumps(planning))
        # Storage changes preserve the runtime pin; incompatible fee rejects.
        rpc("anvil_setStorageAt", [manager, storage_slot, "0x"+format((1 << 96) | (1 << 208), "064x")])
        rpc("anvil_mine", ["0x1"])
        bad_fee = subprocess.run(preview_command, env=env, text=True, capture_output=True)
        assert bad_fee.returncode != 0 and not bad_fee.stdout and "reward conversion route unavailable" in bad_fee.stderr
        rpc("anvil_setStorageAt", [manager, storage_slot, "0x"+format(1 << 96, "064x")])
        rpc("anvil_mine", ["0x1"])
        rpc("anvil_setBalance", [roots["ProtocolFeeVault"], hex(99)])
        rpc("anvil_mine", ["0x1"])
        underfunded = subprocess.run(preview_command, env=env, text=True, capture_output=True)
        assert underfunded.returncode != 0 and not underfunded.stdout and "asset coverage unavailable" in underfunded.stderr
        rpc("anvil_setBalance", [roots["ProtocolFeeVault"], hex(200)])
        rpc("anvil_mine", ["0x1"])
        # Inject a changed canonical header only after the simulated call.
        seen_simulation = []
        class ReorgProxy(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                method, params = req["method"], req["params"]
                value = rpc(method, params)
                if method == "eth_call" and params[0].get("data", "").startswith("0x" + conversion_selector):
                    seen_simulation.append(True)
                elif seen_simulation and method == "eth_getBlockByNumber" and value:
                    value = dict(value, hash="0x" + "fe"*32)
                raw = json.dumps(dict(jsonrpc="2.0", id=req["id"], result=value)).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        proxy = ThreadingHTTPServer(("127.0.0.1", 0), ReorgProxy)
        worker = threading.Thread(target=proxy.serve_forever, daemon=True)
        worker.start()
        try:
            rejected_reorg = subprocess.run(preview_command, env=dict(env, TG_RPC_URL=f"http://127.0.0.1:{proxy.server_port}"), text=True, capture_output=True)
            assert seen_simulation and rejected_reorg.returncode != 0 and not rejected_reorg.stdout
        finally:
            proxy.shutdown()
            proxy.server_close()
            worker.join(timeout=5)
        planning["participants"][1]["maximumMeme"] = "10"
        input_path.write_text(json.dumps(planning))
        changed = subprocess.run(plan_command, env=env, text=True, capture_output=True)
        assert changed.returncode != 0 and not changed.stdout
        # A fresh chain balance change also invalidates the previous quote.
        planning["participants"][1]["maximumMeme"] = "11"
        input_path.write_text(json.dumps(planning))
        vault[selector("creatorLiability(bytes32,uint32,address)")] = uint(8)
        new_vault_code = getter_runtime(vault)
        rpc("anvil_setCode", [roots["ProtocolFeeVault"], new_vault_code])
        for c in observed_manifest["contracts"]:
            if c["module"] == "ProtocolFeeVault":
                c["runtimeCodeHash"] = rpc("web3_sha3", [new_vault_code])
        path.write_text(json.dumps(observed_manifest))
        rpc("anvil_mine", ["0x1"])
        changed = subprocess.run(plan_command, env=env, text=True, capture_output=True)
        assert changed.returncode != 0 and not changed.stdout
        refreshed = subprocess.run(request_command, env=env, text=True, capture_output=True)
        assert refreshed.returncode == 0, refreshed.stderr
        refreshed = json.loads(refreshed.stdout)["candidate"]["request"]
        assert refreshed["items"][-1]["maximumMeme"] == "8" and refreshed["requestDigest"] != request["requestDigest"]
        # Simulated return validation; getter replacement is test-only.
        planning["quote"]["requestDigest"] = refreshed["requestDigest"]
        planning["quote"]["quotedAt"] = int(time.time())
        input_path.write_text(json.dumps(planning))
        for bad_return in [uint(0)+uint(100), uint(1000)+uint(100), uint(7)+uint(98), uint(7)]:
            vault[conversion_selector] = bad_return
            code = getter_runtime(vault)
            rpc("anvil_setCode", [roots["ProtocolFeeVault"], code])
            for c in observed_manifest["contracts"]:
                if c["module"] == "ProtocolFeeVault":
                    c["runtimeCodeHash"] = rpc("web3_sha3", [code])
            path.write_text(json.dumps(observed_manifest))
            rpc("anvil_mine", ["0x1"])
            invalid = subprocess.run(preview_command, env=env, text=True, capture_output=True)
            assert invalid.returncode != 0 and not invalid.stdout
        body["operator"] = user
        input_path.write_text(json.dumps(body))
        rejected = subprocess.run(command, env=env, text=True, capture_output=True)
        assert rejected.returncode != 0 and not rejected.stdout
        assert int(rpc("eth_getTransactionCount", [sender, "latest"]), 16) == int(nonce,16)+1
        print("Conversion state CLI: authenticated synthetic state, roles, live capped request/plan, stale quote binding and wrong-operator rejection passed", flush=True)
        history_path = data / "conversion-check-history.json"
        history_path.write_text(json.dumps(dict(chainId=fixture["policy"]["chainId"], genesisHash=fixture["policy"]["genesisHash"], marketId=fixture["policy"]["marketId"], after=0)))
        history = subprocess.run([str(root / "bin/settlement-worker"), "--check-history", str(history_path)], env=reference_env, text=True, capture_output=True)
        assert history.returncode == 0, history.stderr
        history = json.loads(history.stdout)
        assert len(history["records"]) == 5 and history["auditOnly"] and not history["transactionSubmission"]
        assert history["records"][0]["digest"] == fetched["record"]["digest"]
        assert history["records"][0]["sequence"] == fetched["record"]["sequence"]
        assert history["records"][1]["sequence"] == completed_sequence
        assert history["records"][2]["sequence"] == prepared_sequence
        db_check = subprocess.run(["go", "test", "-race", "-count=1", "./internal/settlement", "-run", "TestIsolatedSettlement(Checks|Work|Intent|Signing|Submission)"], cwd=root, env=dict(env, TG_SETTLEMENT_TEST_DSN=env["TG_INDEXER_DATABASE_URL"]), text=True, capture_output=True)
        assert db_check.returncode == 0, db_check.stdout + db_check.stderr

    finally:
        assert rpc("evm_revert", [snapshot])
