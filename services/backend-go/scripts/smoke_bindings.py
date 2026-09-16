"""Synthetic EVM getter fixtures; these are not deployed protocol contracts."""
import json
import signal
import sys
import concurrent.futures
import subprocess
import time
import smoke_discovery


def getter_runtime(entries, emit_topics=None, events=None, event_batches=None):
    # Dispatch on the first four calldata bytes; unknown selectors revert.
    code = bytearray.fromhex("60003560e01c")
    jumps = []
    for selector, result in entries.items():
        code.extend(bytes.fromhex("8063" + selector + "1461"))
        jumps.append((len(code), selector, result))
        code.extend(bytes.fromhex("000057"))
    code.extend(bytes.fromhex("60006000fd"))
    payloads = []
    for position, selector, result in jumps:
        code[position:position + 2] = len(code).to_bytes(2, "big")
        code.extend(bytes.fromhex("5b5061") + len(result).to_bytes(2, "big") + b"\x61")
        payloads.append((len(code), result))
        code.extend(bytes.fromhex("0000600039"))
        topics = (events or {}).get(selector, emit_topics if selector == "feedface" else None)
        if event_batches and selector in event_batches:
            for event_topics, event_data in event_batches[selector]:
                code.extend(b"\x61" + len(event_data).to_bytes(2,"big") + b"\x61")
                payloads.append((len(code),event_data))
                code.extend(bytes.fromhex("0000600039"))
                assert 0 < len(event_topics) <= 4
                code.extend(b"".join(b"\x7f" + bytes.fromhex(t) for t in reversed(event_topics)))
                code.extend(b"\x61" + len(event_data).to_bytes(2,"big") + bytes.fromhex("6000") + bytes([0xa0 + len(event_topics)]))
            code.extend(b"\x00")
        elif topics:
            assert 0 < len(topics) <= 4
            code.extend(b"".join(b"\x7f" + bytes.fromhex(t) for t in reversed(topics)))
            code.extend(b"\x61" + len(result).to_bytes(2, "big") + bytes.fromhex("6000") + bytes([0xa0 + len(topics), 0x00]))
        else:
            code.extend(b"\x61" + len(result).to_bytes(2, "big") + bytes.fromhex("6000f3"))
    # Keep literal bytes after all executable handlers. Inline payloads may end
    # in a PUSH opcode, making a later handler's JUMPDEST invalid during EVM scan.
    for position, result in payloads:
        code[position:position + 2] = len(code).to_bytes(2, "big")
        code.extend(result)
    return "0x" + code.hex()


def run(root, data, env, rpc):
    modules = ["TickerGardenFactoryV1", "OfficialStockRegistryV1", "ApprovedQuoteRegistry",
               "TickerGardenBaselineRegistry", "LaunchTemplateRegistry", "MarketRegistryV1",
               "ProtocolFeeVault", "AllocationManager", "LaunchAndBuyRouter"]
    addresses = ["0x" + format(0x1000 + i, "040x") for i in range(9)]
    words = [bytes.fromhex("00" * 12 + a[2:]) for a in addresses]
    registry = dict(zip([rpc("web3_sha3", ["0x" + signature.encode().hex()])[2:10] for signature in ["factory()", "officialStockRegistry()", "approvedQuoteRegistry()", "tickerGardenBaselineRegistry()", "launchTemplateRegistry()"]], words[:5]))
    staking = env.get("TG_SMOKE_STAKING") == "1"
    holder = env.get("TG_SMOKE_HOLDER") == "1"
    market_id = "11" * 32
    config_id = "22" * 32
    zero = "00" * 32
    token, curve = "0x" + format(0x2000, "040x"), "0x" + format(0x2001, "040x")
    token_word, curve_word = "00" * 12 + token[2:], "00" * 12 + curve[2:]
    gauge = "0x" + format(0x2002, "040x")
    gauge_word = "00" * 12 + gauge[2:] if staking else zero
    asset_uid = "33" * 32 if staking else zero
    # Both staking variants retain native Quote and initial curve phase.

    state = [asset_uid, config_id, config_id, config_id, config_id,
             rpc("web3_sha3", ["0x" + b"V1-EXEC-11".hex()])[2:], config_id, zero,
             words[1].hex(), token_word, curve_word, gauge_word, zero, format(0x2044, "064x"),
             zero, format(int(holder), "064x"), format(int(staking), "064x"), zero, format(1, "064x"), zero]
    registry["5c60e39a"] = bytes.fromhex("".join(state))
    registry["69b62bd3"] = bytes.fromhex(market_id)
    pool_key = bytes.fromhex(zero + token_word + zero + format(60, "064x") + format(0x2044, "064x"))
    pool_id = rpc("web3_sha3", ["0x" + pool_key.hex()])[2:]
    route = pool_key + bytes.fromhex(pool_id + words[7].hex() + words[8].hex() + format(0x2044, "064x") + zero + token_word + gauge_word + curve_word + format(0x5000, "064x") + format(1, "064x") + zero + format(1, "064x") + zero)
    for signature, value in {"canonicalPoolKey(bytes32)": pool_key, "canonicalPoolId(bytes32)": bytes.fromhex(pool_id), "canonicalRoute(bytes32)": route, "swapRouter()": words[7], "quoter()": words[8], "graduationExecutor()": words[6], "activeFeeSource(bytes32)": bytes.fromhex(curve_word + format(1, "064x"))}.items():
        registry[rpc("web3_sha3", ["0x" + signature.encode().hex()])[2:10]] = value

    topic = rpc("web3_sha3", ["0x" + b"MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)".hex()])[2:]
    event_data = bytes.fromhex(curve_word + gauge_word + zero + config_id * 3)
    runtimes = ["0x00"] * 9
    runtimes[0] = getter_runtime({"4dffb637": b"".join(words[1:]), "feedface": event_data},
                                [topic, market_id, asset_uid, token_word])
    runtimes[2] = getter_runtime({"e4acb862": words[1]})
    runtimes[5] = getter_runtime(registry)
    # Full baseline getter plus an authentic event emitter for config persistence.
    baseline_words = [format(46630, "064x"), words[0].hex(), config_id, format(1, "064x"), format(1000000, "064x"), format(100, "064x"), zero, format(60, "064x"), config_id, format(1, "064x")]
    baseline_selector = rpc("web3_sha3", ["0x" + b"baseline(bytes32)".hex()])[2:10]
    baseline_topic = rpc("web3_sha3", ["0x" + b"TickerGardenBaselineAdded(bytes32,bytes32,bytes32)".hex()])[2:]
    runtimes[3] = getter_runtime({baseline_selector: bytes.fromhex("".join(baseline_words)), "feedface": bytes.fromhex(config_id)}, [baseline_topic, config_id, config_id])

    asset_fixture = staking or env.get("TG_SMOKE_VAULT") == "1"
    if asset_fixture:
        selector = lambda signature: rpc("web3_sha3", ["0x" + signature.encode().hex()])[2:10]
        digest = lambda signature: rpc("web3_sha3", ["0x" + signature.encode().hex()])[2:]
        payload = lambda *values: b"".join(int(value).to_bytes(32, "big") for value in values)
        vault = "0x" + format(0x3000, "040x")
        stock = "0x" + format(0x3001, "040x")
        vault_word, stock_word = "00" * 12 + vault[2:], "00" * 12 + stock[2:]
        registered_uid = "33" * 32
        schema = digest("TickerGarden.UserStockVault.MultiAsset.v6")
        user_word = "00" * 12 + rpc("eth_accounts", [])[0][2:]
        vault_entries = {selector("vaultIdentity()"): bytes.fromhex(words[1].hex() + words[5].hex() + words[7].hex() + schema),
                         selector("totalDeposited(bytes32)"): payload(100), selector("totalAllocated(bytes32)"): payload(60),
                         selector("deposited(bytes32,address)"): payload(90), selector("allocated(bytes32,address)"): payload(50),
                         selector("freeBalanceOf(bytes32,address)"): payload(40),
                         selector("marketAllocated(bytes32,bytes32)"): payload(60),
                         selector("marketRewardEligible(bytes32,bytes32)"): payload(40),
                         selector("marketRewardCohortEpoch(bytes32,bytes32)"): payload(2),
                         selector("allocation(bytes32,address,bytes32)"): payload(50),
                         selector("rageQuitRewardCutoff(bytes32,address,bytes32)"): payload(0, 0, 0, 0),
                         "feedface": payload(90), "feedbeef": payload(40,40,40)}
        vault_code = getter_runtime(vault_entries, [digest("StockDeposited(bytes32,address,uint256)"), registered_uid, user_word], {"feedbeef": [digest("AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)"), registered_uid, user_word, market_id]})
        stock_code = getter_runtime({selector("balanceOf(address)"): payload(100)})
        vault_hash = rpc("web3_sha3", [vault_code])[2:]
        stock_hash = rpc("web3_sha3", [stock_code])[2:]
        asset_entries = {selector("minimumAllocation(bytes32)"): payload(414), selector("asset(bytes32)"): bytes.fromhex(stock_word + vault_word) + payload(18, 1),
                         selector("assetIdentityCurrent(bytes32)"): payload(1), selector("vaultIdentityCurrent(address)"): payload(1),
                         selector("vaultSchemaId(address)"): bytes.fromhex(schema),
                         selector("vaultForSchema(bytes32)"): bytes.fromhex(vault_word),
                         selector("vaultRuntimeCodeHash(address)"): bytes.fromhex(vault_hash),
                         selector("assetFingerprint(bytes32)"): bytes.fromhex(stock_hash + zero + zero + stock_word + stock_hash),
                         "feedface": payload(18)}
        runtimes[1] = getter_runtime(asset_entries, [digest("AssetRegistered(bytes32,address,address,uint8)"), registered_uid, stock_word, vault_word])
        rpc("anvil_setCode", [vault, vault_code])
        rpc("anvil_setCode", [stock, stock_code])
    selector = lambda signature: rpc("web3_sha3", ["0x" + signature.encode().hex()])[2:10]
    payload = lambda *values: b"".join(int(value).to_bytes(32, "big") for value in values)
    creator_registry = "0x" + format(0x4000, "040x")
    creator_word = "00" * 12 + creator_registry[2:]
    def selector_topic(signature):
        return rpc("web3_sha3", ["0x" + signature.encode().hex()])[2:]
    runtimes[7] = getter_runtime({selector("rageQuitSettlementPending(bytes32,address)"): payload(0,0), selector("settleRageQuitRewards(bytes32,address)"): payload(7,9,1)})
    runtimes[6] = getter_runtime({selector("marketRegistry()"): words[5],
                                 selector("creatorRevenueRegistry()"): bytes.fromhex(creator_word),
                                 selector("feePolicyId()"): bytes.fromhex(config_id),
                                 selector("liability(bytes32,address,uint8)"): payload(1),
                                 selector("creatorLiability(bytes32,uint32,address)"): payload(1),
                                 selector("rawRewardExitAt(bytes32,address)"): payload(1),
                                 selector("holderLiability(bytes32,uint32,address)"): payload(1),
                                 selector("forfeitureReserve(bytes32,address)"): payload(1),
                                 selector("totalLiability(address)"): payload(5),
                                 "feedface": payload(1,0,7), "feedcafe": b""},
                                [rpc("web3_sha3", ["0x" + b"FeeClaimed(uint8,address,bytes32,uint32,address,uint256)".hex()])[2:], zero, words[1].hex(), market_id], event_batches={"feedcafe":[
                                  ([selector_topic("RewardConverted(bytes32,address,uint32,uint256,uint256)"),market_id,words[1].hex(),format(1,"064x")],payload(7,11)),
                                  ([selector_topic("RewardBatchConverted(bytes32,uint256,address,address,uint256,uint256)"),market_id,format(1,"064x")],bytes.fromhex(token_word+zero)+payload(7,11))
                                ]})
    creator_code = getter_runtime({selector("factory()"): words[0], selector("marketRegistry()"): words[5],
                                   selector("currentCreatorEpoch(bytes32)"): payload(1),
                                   selector("creatorBeneficiaryAt(bytes32,uint32)"): words[1]})
    treasury = "0x" + format(0x5000, "040x")
    treasury_word = bytes.fromhex("00" * 12 + treasury[2:])
    if holder:
        runtimes[0] = getter_runtime({"4dffb637": b"".join(words[1:]), "feedface": event_data,
                                     selector("treasuryDistributor()"): treasury_word},
                                    [topic, market_id, asset_uid, token_word])
        treasury_entries = {selector("marketRegistry()"): words[5],
                            selector("EPOCH_DURATION()"): payload(7 * 24 * 60 * 60),
                            selector("TWAB_SCHEMA()"): bytes.fromhex(rpc("web3_sha3", ["0x" + b"TRANSFER_LOG_TWAB_7D_V1".hex()])[2:]),
                            selector("market(bytes32)"): bytes.fromhex(token_word + zero + config_id) + payload(100),
                            selector("feeSharingVault(bytes32)"): words[6],
                            selector("currentEpochId(bytes32)"): payload(1),
                            selector("rootServiceFee()"): payload(0, 2),
                            selector("epoch(bytes32,uint32)"): payload(200, 300, 400, 500, 1, 1, 3, 1, 0, 2, 1, 2, 3, 5, 2, 10),
                            selector("epochQuoteAmount(bytes32,uint32)"): payload(5),
                            selector("epochWindow(bytes32,uint32)"): payload(100, 200),
                            selector("totalQuoteLiability(address)"): payload(3),
                            selector("totalServiceLiability(address)"): payload(2)}
        rpc("anvil_setCode", [treasury, getter_runtime(treasury_entries)])
        rpc("anvil_setBalance", [treasury, "0xa"])
    rpc("anvil_setCode", [creator_registry, creator_code])
    rpc("anvil_setBalance", [addresses[6], "0xa"])
    for address, code in zip(addresses, runtimes):
        rpc("anvil_setCode", [address, code])
    for address in [token, curve]:
        rpc("anvil_setCode", [address, "0x00"])
    curve_getters = {selector(name): payload(0) for name in ["quoteAsset()", "realQuoteReserve()", "sellableTokens()", "reservedTokens()", "readyToGraduate()", "creatorTaxBps()", "accruedCreatorTax()", "sweepNonce()"]}
    curve_getters.update({selector("getReserves()"): payload(0) + payload(0), selector("accruedCurveFees()"): payload(7), selector("sweepCurveFees()"): payload(7)})
    rpc("anvil_setCode", [curve, getter_runtime(curve_getters)])
    rpc("anvil_setCode", [token, getter_runtime({selector("balanceOf(address)"): payload(10), selector("treasuryDistributor()"): treasury_word})])
    if staking:
        selector = lambda signature: rpc("web3_sha3", ["0x" + signature.encode().hex()])[2:10]
        payload = lambda *values: b"".join(int(value).to_bytes(32, "big") for value in values)
        identity = bytes.fromhex(market_id + asset_uid + config_id + words[7].hex() + words[6].hex() + zero + token_word)
        entries = {selector("gaugeIdentity()"): identity,
                   selector("checkpointActivations()"): payload(4,1),
                   selector("flushDeferredForfeiture()"): b"",
                   selector("storedTotalActiveStock()"): payload(10),
                   selector("effectiveTotalActiveStock()"): payload(8),
                   selector("totalPendingStock()"): payload(4),
                   selector("rewardState(address)"): payload(2**256 - 1, 3),
                   selector("deferredForfeiture()"): payload(7, 9),
                   selector("positionOf(address)"): payload(6, 4, 5, 100, 7, 9),
                   selector("activationSnapshot(uint64)"): payload(1, 2, 1, 1),
                   "feedface": payload(4, 5, 100)}
        pending_topic = rpc("web3_sha3", ["0x" + b"PendingScheduled(address,bytes32,uint256,uint64,uint64)".hex()])[2:]
        rpc("anvil_setCode", [gauge, getter_runtime(entries, [pending_topic, format(0x777, "064x"), market_id])])
    rpc("anvil_mine", ["0x1"])
    installed = int(rpc("eth_blockNumber", []), 16)
    # Adjacent empty/creation blocks exercise resume without redundant empty history.
    tx = rpc("eth_sendTransaction", [{"from": rpc("eth_accounts", [])[0], "to": addresses[0],
                                      "data": "0xfeedface", "gas": "0x186a0"}])
    receipt = None
    for _ in range(50):
        receipt = rpc("eth_getTransactionReceipt", [tx])
        if receipt is not None:
            break
        time.sleep(0.1)
    assert receipt and receipt["status"] == "0x1" and len(receipt["logs"]) == 1, receipt
    for _ in range(4):
        if int(rpc("eth_getBlockByNumber", ["finalized", False])["number"], 16) >= int(receipt["blockNumber"], 16):
            break
        rpc("anvil_mine", ["0x20"])
    else:
        raise RuntimeError("binding fixtures did not finalize")
    manifest = dict(executionSpecId="V1-EXEC-11", chainId=46630,
                    genesisHash=rpc("eth_getBlockByNumber", ["0x0", False])["hash"],
                    contracts=[dict(module=m, address=a, runtimeCodeHash=rpc("web3_sha3", [c]))
                               for m, a, c in zip(modules, addresses, runtimes)])
    path = data / "synthetic-core-bindings.json"
    path.write_text(json.dumps(manifest))
    command = [str(root / "bin/verify-deployment"), "--core-bindings", str(path)]
    result = subprocess.run(command, env=env, capture_output=True, text=True, check=True)
    body = json.loads(result.stdout)
    assert body["status"] == "core_runtime_bindings_verified" and body["coreBindingsVerified"]
    assert not body["protocolBindingsVerified"] and not body["transactionSubmission"]
    empty = subprocess.run([str(root / "bin/verify-deployment"), "--discover-block", hex(installed), str(path)],
                           env=env, capture_output=True, text=True, check=True)
    assert json.loads(empty.stdout)["markets"] == []
    discovered = subprocess.run([str(root / "bin/verify-deployment"), "--discover-block", receipt["blockNumber"], str(path)],
                                env=env, capture_output=True, text=True, check=True)
    market = json.loads(discovered.stdout)["markets"][0]
    assert market["marketId"] == "0x" + market_id and len(market["contracts"]) == 2 + int(staking)
    assert market["state"]["stakingEnabled"] == staking and market["source"]["transactionHash"] == tx
    preview_manifest = dict(manifest, contracts=manifest["contracts"] + market["contracts"])
    preview_path = data / "synthetic-maintenance-bindings.json"
    preview_path.write_text(json.dumps(preview_manifest))
    sender = rpc("eth_accounts", [])[0]
    from smoke_conversion_state import run as conversion_state_smoke
    conversion_state_smoke(root, data, env, rpc, preview_manifest, registry, state, token, creator_registry, sender, addresses[1], staking)
    preview_command = [str(root / "bin/maintenance-worker"), "--preview", "--manifest", str(preview_path),
                       "--market", market["marketId"], "--trigger", "0x" + "11"*32, "--from", sender]
    before_nonce = rpc("eth_getTransactionCount", [sender, "latest"])
    operations = ["settle-rage-quit"] + (["checkpoint", "flush-forfeiture"] if staking else [])
    for operation in operations:
        args = preview_command + ["--operation", operation]
        if operation == "settle-rage-quit":
            args += ["--user", sender]
        preview = subprocess.run(args, env=env, capture_output=True, text=True, check=True)
        result = json.loads(preview.stdout)
        assert result["status"] == "simulated" and result["from"] == sender
        assert result["value"] == "0x0" and not result["transactionSubmission"] and not result["executionComplete"]
        if operation == "settle-rage-quit":
            assert result["returnValues"] == dict(quoteForfeited="7", memeForfeited="9", redistributed=True)
        elif operation == "checkpoint":
            assert result["returnValues"] == dict(activatedAmount="4", processedBuckets="1")
        else:
            assert result["returnValues"] == {}
    record_env = dict(env, TG_MAINTENANCE_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"])
    discovery_base = [str(root / "bin/maintenance-worker"), "--discover-work", "--manifest", str(preview_path), "--from", sender, "--market", "0x" + market_id]
    not_needed = json.loads(subprocess.run(discovery_base + ["--operation", "settle-rage-quit", "--user", sender], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert not_needed["discovery"]["status"] == "not_needed" and "jobKey" not in not_needed["discovery"]
    discovery_args = discovery_base + ["--operation", "sweep"]
    discovered_work = json.loads(subprocess.run(discovery_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert discovered_work["discovery"]["status"] == "prepared" and discovered_work["discovery"]["generation"] == 1
    def discover_again(_):
        return json.loads(subprocess.run(discovery_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        discoveries = list(executor.map(discover_again, range(4)))
    assert all(item["discovery"]["status"] == "awaiting_existing" and item["discovery"]["jobKey"] == discovered_work["discovery"]["jobKey"] and item["discovery"]["generation"] == 1 for item in discoveries)
    discovered_history = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--history", discovered_work["discovery"]["jobKey"]], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert len(discovered_history["records"]) == 1 and discovered_history["records"][0]["preview"]["request"]["operation"] == "sweep"
    assert rpc("eth_getTransactionCount", [sender, "latest"]) == before_nonce
    print("Maintenance discovery: unmet state, atomic simulation, concurrent scope deduplication and no-work skip passed", flush=True)
    record_args = preview_command + ["--operation", "settle-rage-quit", "--user", sender, "--record"]
    saved = json.loads(subprocess.run(record_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    duplicate = json.loads(subprocess.run(record_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert saved == duplicate
    key = saved["preview"]["key"]
    history_command = [str(root / "bin/maintenance-worker"), "--history", key]
    history = json.loads(subprocess.run(history_command, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert history["records"] == [saved] and history["executionComplete"] is False
    page = json.loads(subprocess.run(history_command + ["--after", str(saved["sequence"])], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert page["records"] == []
    check_env = dict(env, TG_MAINTENANCE_TEST_DSN=env["TG_INDEXER_DATABASE_URL"], TG_MAINTENANCE_TEST_KEY=key, TG_MAINTENANCE_TEST_SCOPE=discovered_work["discovery"]["scopeKey"], TG_MAINTENANCE_TEST_MANIFEST=str(preview_path))
    subprocess.run(["go", "test", "-race", "./internal/maintenance", "-run", "TestIsolatedMaintenance", "-count=1", "-v"], cwd=root, env=check_env, check=True)
    atomic_command = [arg for arg in preview_command if arg != "--preview"]
    atomic_command[atomic_command.index("--from")+1] = rpc("eth_accounts", [])[2]
    atomic_command += ["--operation", "settle-rage-quit", "--user", sender, "--prepare-atomic", "--owner", "atomic-cli", "--token", "0x"+"ac"*32, "--ttl", "300", "--gas-limit", "200000", "--max-fee-per-gas", "100000000000", "--priority-fee-per-gas", "1000000000"]
    atomic_result = json.loads(subprocess.run(atomic_command, env=record_env, capture_output=True, text=True, check=True).stdout)
    atomic_retry = json.loads(subprocess.run(atomic_command, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert atomic_result == atomic_retry and not atomic_result["transactionSubmission"] and not atomic_result["executionComplete"]
    print("Atomic preparation: cross-process retry preserves lease, nonce and exact intent without submission", flush=True)
    lease_args = [str(root / "bin/maintenance-worker"), "--job", key, "--owner", "cli-smoke", "--token", "0x" + "ab"*32]
    acquired = json.loads(subprocess.run(lease_args + ["--lease", "acquire"], env=record_env, capture_output=True, text=True, check=True).stdout)
    retried = json.loads(subprocess.run(lease_args + ["--lease", "acquire"], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert acquired == retried and acquired["lease"]["generation"] == 4
    fence = str(acquired["lease"]["generation"])
    renewed = json.loads(subprocess.run(lease_args + ["--lease", "renew", "--generation", fence], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert renewed["lease"]["generation"] == 4 and renewed["executionComplete"] is False
    released = json.loads(subprocess.run(lease_args + ["--lease", "release", "--generation", fence], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert released["lease"]["released"] is True and released["transactionSubmission"] is False
    nonce_token = "0x" + "cd"*32
    nonce_lease_args = [str(root / "bin/maintenance-worker"), "--job", key, "--owner", "nonce-cli", "--token", nonce_token]
    nonce_lease = json.loads(subprocess.run(nonce_lease_args + ["--lease", "acquire"], env=record_env, capture_output=True, text=True, check=True).stdout)["lease"]
    reserve_args = preview_command + ["--operation", "settle-rage-quit", "--user", sender, "--reserve-nonce", "--owner", "nonce-cli", "--token", nonce_token, "--generation", str(nonce_lease["generation"])]
    reserved = json.loads(subprocess.run(reserve_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    retry_reserved = json.loads(subprocess.run(reserve_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert reserved == retry_reserved and int(reserved["reservation"]["nonce"]) == int(before_nonce,16)
    restored = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--reservation", key], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert restored == reserved and reserved["transactionSubmission"] is False
    prepare_args = preview_command + ["--operation", "settle-rage-quit", "--user", sender, "--prepare-intent", "--owner", "nonce-cli", "--token", nonce_token, "--generation", str(nonce_lease["generation"]), "--gas-limit", "200000", "--max-fee-per-gas", "100000000000", "--priority-fee-per-gas", "1000000000"]
    prepared = json.loads(subprocess.run(prepare_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    retried_intent = json.loads(subprocess.run(prepare_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert prepared == retried_intent and prepared["record"]["intent"]["status"] == "intent_prepared"
    assert prepared["record"]["intent"]["maximumGasCost"] == "20000000000000000"
    inspected = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--intent", key], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert inspected == prepared and prepared["transactionSubmission"] is False
    signing_call = dict(prepared["record"]["intent"]["call"], type="0x2", chainId=hex(46630))
    signed_response = rpc("eth_signTransaction", [signing_call])
    signed_raw = signed_response["raw"] if isinstance(signed_response, dict) else signed_response
    signed_file = data / "synthetic-maintenance-signed.hex"
    signed_file.write_text(signed_raw)
    signer_path = data / "test-only-signer.sh"
    signed_hex = signed_file.read_text().strip()
    assert signed_hex.startswith("0x") and all(c in "0123456789abcdefABCDEF" for c in signed_hex[2:])
    signer_path.write_text("#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '" + signed_hex + "'\n")
    signer_path.chmod(0o700)
    signer_args = [str(root / "bin/maintenance-worker"), "--sign-with", str(signer_path), "--job", key, "--owner", "nonce-cli", "--token", nonce_token, "--generation", str(nonce_lease["generation"]), "--intent-digest", prepared["record"]["digest"]]
    signer_result = json.loads(subprocess.run(signer_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    signer_path.write_text("#!/bin/sh\nexit 99\n")
    import_args = [str(root / "bin/maintenance-worker"), "--import-signature", str(signed_file), "--job", key, "--intent-digest", prepared["record"]["digest"], "--transaction-hash", rpc("web3_sha3", [signed_hex]), "--owner", "nonce-cli", "--token", nonce_token, "--generation", str(nonce_lease["generation"])]
    imported_result = json.loads(subprocess.run(import_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    imported_retry = json.loads(subprocess.run(import_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert imported_result == imported_retry and imported_result["signatureImport"]["status"] == "signed_stored" and not imported_result["transactionSubmission"]

    signer_retry = json.loads(subprocess.run(signer_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert signer_result == signer_retry and signer_result["signing"]["status"] == "signed_stored"
    assert not signer_result["transactionSubmission"]
    attach_args = [str(root / "bin/maintenance-worker"), "--attach-signed", str(signed_file), "--job", key, "--owner", "nonce-cli", "--token", nonce_token, "--generation", str(nonce_lease["generation"]), "--intent-digest", prepared["record"]["digest"]]
    attached = json.loads(subprocess.run(attach_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    duplicate_signed = json.loads(subprocess.run(attach_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert attached == duplicate_signed and attached["signed"]["rawTransaction"] == signed_raw
    assert attached["signed"]["transactionHash"] == rpc("web3_sha3", [signed_raw])
    signed_history = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--signed", key], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert signed_history == attached and attached["transactionSubmission"] is False
    wrong_call = dict(signing_call, value="0x1")
    wrong_response = rpc("eth_signTransaction", [wrong_call])
    signed_file.write_text(wrong_response["raw"] if isinstance(wrong_response, dict) else wrong_response)
    rejected = subprocess.run(attach_args, env=record_env, capture_output=True, text=True)
    assert rejected.returncode != 0 and "does not match" in rejected.stderr
    assert rpc("eth_getTransactionCount", [sender, "latest"]) == before_nonce
    print("Maintenance preview: authenticated fixed calls, EVM simulation and unchanged sender nonce passed", flush=True)

    # Keep the broadcast scenario in its own local branch: downstream projection
    # fixtures intentionally start with exactly one market-creation block.
    submission_snapshot = rpc("evm_snapshot", [])
    budget_env = dict(record_env, TG_MAINTENANCE_OPERATOR_DATABASE_URL=env["TG_INDEXER_DATABASE_URL"])
    budget_command = [str(root / "bin/maintenance-budget"), "--set", "--manifest", str(preview_path), "--from", sender, "--max-transaction", "20000000000000000", "--maximum-total", "200000000000000000", "--request-id", "0x"+"bd"*32]
    configured_budget = json.loads(subprocess.run(budget_command, env=budget_env, capture_output=True, text=True, check=True).stdout)
    assert configured_budget == json.loads(subprocess.run(budget_command, env=budget_env, capture_output=True, text=True, check=True).stdout)
    assert not configured_budget["transactionSubmission"] and configured_budget["budget"]["allocated"] == "0"
    submit_args = [arg for arg in preview_command if arg != "--preview"] + ["--submit", "--operation", "settle-rage-quit", "--user", sender, "--transaction-hash", attached["signed"]["transactionHash"], "--owner", "nonce-cli", "--token", nonce_token, "--generation", str(nonce_lease["generation"])]
    submitted = json.loads(subprocess.run(submit_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert submitted["submission"]["status"] == "acknowledged" and submitted["executionComplete"] is False
    submission_retry = json.loads(subprocess.run(submit_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert submission_retry == submitted
    submission_read = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--submission", key], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert submission_read == submitted
    submission_receipt = None
    for _ in range(100):
        submission_receipt = rpc("eth_getTransactionReceipt", [submitted["submission"]["transactionHash"]])
        if submission_receipt is not None:
            break
        time.sleep(0.02)
    assert submission_receipt and submission_receipt["status"] == "0x1"
    assert int(rpc("eth_getTransactionCount", [sender, "latest"]), 16) == int(before_nonce, 16) + 1
    observe_receipt_args = [str(root / "bin/maintenance-worker"), "--observe-receipt", key]
    observed_receipt = json.loads(subprocess.run(observe_receipt_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert observed_receipt["record"]["observation"]["status"] in ("mined_success", "finalized_success")
    assert observed_receipt["executionComplete"] is False and observed_receipt["postconditionsVerified"] is False
    assert observed_receipt["record"]["observation"]["receipt"]["transactionHash"] == submitted["submission"]["transactionHash"]
    verify_poststate_args = [str(root / "bin/maintenance-worker"), "--verify-poststate", key, "--manifest", str(preview_path)]
    expected_receipt_records = 3
    if observed_receipt["record"]["observation"]["status"] == "mined_success":
        pending_verification = subprocess.run(verify_poststate_args, env=record_env, capture_output=True, text=True)
        assert pending_verification.returncode != 0 and "requires a finalized successful receipt" in pending_verification.stderr
        expected_receipt_records += 1
    for _ in range(128):
        if int(rpc("eth_getBlockByNumber", ["finalized", False])["number"], 16) >= int(submission_receipt["blockNumber"], 16):
            break
        rpc("anvil_mine", ["0x1"])
    verify_poststate_args = [str(root / "bin/maintenance-worker"), "--verify-poststate", key, "--manifest", str(preview_path)]
    poststate = json.loads(subprocess.run(verify_poststate_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert poststate["executionComplete"] is True and poststate["postconditionsVerified"] is True
    assert poststate["record"]["evidence"]["state"]["values"] == {"pending": False, "principal": "0"}
    reconcile_env = dict(record_env, TG_DEPLOYMENT_MANIFEST=str(preview_path), TG_MAINTENANCE_POLL_INTERVAL="1s")
    reconcile_command = [str(root / "bin/maintenance-reconciler"), "--once"]
    reconciled = json.loads(subprocess.run(reconcile_command, env=reconcile_env, capture_output=True, text=True, check=True).stdout)
    assert reconciled["jobKey"] == key and reconciled["status"] == "verified_complete" and reconciled["poststateSequence"] > 0
    assert reconciled["gasStatus"] == "recorded" and reconciled["gasSequence"] > 0
    expected_receipt_records += 1
    idle_reconcile = json.loads(subprocess.run(reconcile_command, env=reconcile_env, capture_output=True, text=True, check=True).stdout)
    assert idle_reconcile == {"action": "idle"}
    reconcile_process = subprocess.Popen([str(root / "bin/maintenance-reconciler"), "--run"], env=reconcile_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        time.sleep(0.5)
        reconcile_process.send_signal(signal.SIGTERM)
        reconcile_stdout, reconcile_stderr = reconcile_process.communicate(timeout=5)
        assert reconcile_process.returncode == 0 and env["TG_INDEXER_DATABASE_URL"] not in reconcile_stdout + reconcile_stderr
    finally:
        if reconcile_process.poll() is None:
            reconcile_process.kill()
            reconcile_process.wait()
    print("Maintenance reconciler: durable discovery, final poststate, restart idle and SIGTERM passed", flush=True)
    gas_command = [str(root / "bin/maintenance-gas"), "--observe", key]
    gas_observed = json.loads(subprocess.run(gas_command, env=record_env, capture_output=True, text=True, check=True).stdout)
    expected_receipt_records += 1
    cost = gas_observed["record"]["cost"]
    assert int(cost["executionGasCost"]) == int(submission_receipt["gasUsed"], 16) * int(submission_receipt["effectiveGasPrice"], 16)
    assert cost["receiptStatus"] == "finalized_success" and not cost["totalNativeFeeKnown"] and not gas_observed["budgetRelease"]
    gas_history = json.loads(subprocess.run([str(root / "bin/maintenance-gas"), "--history", key], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert gas_history["historical"] and len(gas_history["records"]) == 2
    assert gas_history["records"][0]["sequence"] == reconciled["gasSequence"] and gas_history["records"][0]["cost"]["receiptSequence"] == reconciled["receiptSequence"]
    assert gas_history["records"][-1] == gas_observed["record"]
    assert json.loads(subprocess.run([str(root / "bin/maintenance-gas"), "--history", key, "--after", str(gas_observed["record"]["sequence"])], env=record_env, capture_output=True, text=True, check=True).stdout)["records"] == []
    print("Maintenance gas: finalized receipt execution cost, persisted history and pagination passed", flush=True)

    assert rpc("evm_revert", [submission_snapshot]) is True
    assert rpc("eth_getTransactionReceipt", [submitted["submission"]["transactionHash"]]) is None
    absent_receipt = json.loads(subprocess.run(observe_receipt_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert absent_receipt["record"]["observation"]["status"] == "not_observed"
    receipt_records = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--receipt-history", key], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert receipt_records["historical"] is True and len(receipt_records["records"]) == expected_receipt_records
    assert receipt_records["records"][0] == observed_receipt["record"] and receipt_records["records"][-1] == absent_receipt["record"]
    assert any(row["sequence"] == poststate["record"]["evidence"]["receiptSequence"] for row in receipt_records["records"])
    receipt_page = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--receipt-history", key, "--after", str(observed_receipt["record"]["sequence"])], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert receipt_page["records"] == receipt_records["records"][1:]
    unavailable_gas = subprocess.run(gas_command, env=record_env, capture_output=True, text=True)
    assert unavailable_gas.returncode != 0 and "not finalized" in unavailable_gas.stderr
    assert json.loads(subprocess.run([str(root / "bin/maintenance-gas"), "--history", key], env=record_env, capture_output=True, text=True, check=True).stdout) == gas_history
    recovery_snapshot = rpc("evm_snapshot", [])
    recovery_id = "0x" + "ef" * 32
    recovery_args = [arg for arg in preview_command if arg != "--preview"] + ["--rebroadcast", "--operation", "settle-rage-quit", "--user", sender, "--transaction-hash", submitted["submission"]["transactionHash"], "--attempt-id", recovery_id]
    recovered = json.loads(subprocess.run(recovery_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert recovered["attempt"]["status"] == "acknowledged" and recovered["attempt"]["transactionHash"] == submitted["submission"]["transactionHash"]
    recovered_retry = json.loads(subprocess.run(recovery_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    recovered_read = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--rebroadcast-attempt", key, "--attempt-id", recovery_id], env=record_env, capture_output=True, text=True, check=True).stdout)
    assert recovered_retry == recovered == recovered_read
    for _ in range(100):
        if rpc("eth_getTransactionReceipt", [recovered["attempt"]["transactionHash"]]) is not None:
            break
        time.sleep(0.02)
    assert int(rpc("eth_getTransactionCount", [sender, "latest"]), 16) == int(before_nonce, 16) + 1
    assert rpc("evm_revert", [recovery_snapshot]) is True
    print("Maintenance recovery: fixed signed bytes, durable request ID, retry/read and local rebroadcast passed", flush=True)
    print("Maintenance submission: durable single send, cross-process retry/read and successful local receipt passed", flush=True)


    route_result = subprocess.run([str(root / "bin/verify-deployment"), "--market-route", "0x" + market_id, str(path)], env=env, capture_output=True, text=True, check=True)
    route_body = json.loads(route_result.stdout)
    assert route_body["status"] == "market_route_observed" and not route_body["transactionSubmission"]
    route_observations = {row["kind"]: row["value"] for row in route_body["observation"]["observations"]}
    assert route_observations["canonicalRoute"]["poolId"] == "0x" + pool_id
    assert route_observations["canonicalRoute"]["curveTradingEnabled"] and not route_observations["canonicalRoute"]["poolTradingEnabled"]
    future = hex(int(rpc("eth_blockNumber", []), 16) + 1)
    rejected = subprocess.run([str(root / "bin/verify-deployment"), "--discover-block", future, str(path)],
                              env=env, capture_output=True, text=True)
    assert rejected.returncode != 0 and "finalized" in rejected.stderr
    smoke_discovery.run(root, data, env, rpc, path, installed, receipt)
    scan_env = dict(record_env, TG_DEPLOYMENT_MANIFEST=str(preview_path), TG_MAINTENANCE_FROM=sender)
    scan_command = [str(root / "bin/maintenance-scanner"), "--once"]
    scan_results = []
    nonce_before_scan = rpc("eth_getTransactionCount", [sender, "latest"])
    for _ in range(100):
        response = subprocess.run(scan_command, env=scan_env, capture_output=True, text=True)
        value = json.loads(response.stdout)
        if value["action"] == "idle":
            break
        assert value["action"] == "checked", value
        assert response.returncode == (1 if value["status"] == "unavailable" else 0), response.stderr
        scan_results.append(value)
    assert {r["operation"] for r in scan_results} >= {"checkpoint", "flush-forfeiture", "sweep", "treasury-activate"}
    assert next(r for r in scan_results if r["operation"] == "sweep")["status"] == "awaiting_existing", scan_results
    assert json.loads(subprocess.run(scan_command, env=scan_env, capture_output=True, text=True, check=True).stdout)["action"] == "idle"
    assert rpc("eth_getTransactionCount", [sender, "latest"]) == nonce_before_scan
    scanner = subprocess.Popen([str(root / "bin/maintenance-scanner"), "--run"], env=scan_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert json.loads(scanner.stdout.readline())["action"] == "idle"
        scanner.send_signal(signal.SIGTERM)
        _, errors = scanner.communicate(timeout=10)
        assert scanner.returncode == 0, errors
    finally:
        if scanner.poll() is None:
            scanner.kill()
            scanner.wait()
    prepare_env = dict(scan_env, TG_MAINTENANCE_GAS_LIMIT="200000", TG_MAINTENANCE_MAX_FEE_PER_GAS="100000000000", TG_MAINTENANCE_PRIORITY_FEE_PER_GAS="1000000000")
    prepare_command = [str(root / "bin/maintenance-preparer"), "--once"]
    prepared_jobs = []
    for _ in range(100):
        response = subprocess.run(prepare_command, env=prepare_env, capture_output=True, text=True)
        value = json.loads(response.stdout)
        if value["action"] == "idle":
            break
        assert response.returncode == (1 if value["status"] == "unavailable" else 0), response.stderr
        if value["status"] == "intent_prepared":
            prepared_jobs.append(value["jobKey"])
    assert discovered_work["discovery"]["jobKey"] in prepared_jobs, prepared_jobs
    assert json.loads(subprocess.run(prepare_command, env=prepare_env, capture_output=True, text=True, check=True).stdout)["action"] == "idle"
    assert rpc("eth_getTransactionCount", [sender, "latest"]) == nonce_before_scan
    preparer = subprocess.Popen([str(root / "bin/maintenance-preparer"), "--run"], env=prepare_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert json.loads(preparer.stdout.readline())["action"] == "idle"
        preparer.send_signal(signal.SIGTERM)
        _, errors = preparer.communicate(timeout=10)
        assert preparer.returncode == 0, errors
    finally:
        if preparer.poll() is None:
            preparer.kill()
            preparer.wait()
    preparer_test_env = dict(prepare_env, TG_MAINTENANCE_PREPARER_TEST_DSN=env["TG_INDEXER_DATABASE_URL"], TG_MAINTENANCE_TEST_MANIFEST=str(preview_path), TG_MAINTENANCE_PREPARED_TEST_KEY=discovered_work["discovery"]["jobKey"])
    subprocess.run(["go", "test", "-race", "./internal/maintenance", "-run", "^TestIsolatedMaintenancePreparer$", "-count=1", "-v"], cwd=root, env=preparer_test_env, check=True)
    # The preparer recovery test expires this job's original authorization.
    recovered_key = discovered_work["discovery"]["jobKey"]
    recovered_intent = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--intent", recovered_key], env=record_env, capture_output=True, text=True, check=True).stdout)["record"]
    auth_args = [str(root / "bin/maintenance-worker"), "--recover-authorization", "--recovery-id", "0x"+"af"*32, "--manifest", str(preview_path), "--from", sender, "--market", market["marketId"], "--operation", "sweep", "--trigger", discovered_work["discovery"]["state"]["request"]["triggerId"], "--intent-digest", recovered_intent["digest"], "--owner", "maintenance-preparer"]
    # The acquisition token is derived from the durable first preparation claim.
    auth_token = rpc("web3_sha3", ["0x"+(recovered_key+":1").encode().hex()])
    auth_args += ["--token", auth_token, "--generation", str(recovered_intent["intent"]["reservation"]["generation"])]
    auth_result = json.loads(subprocess.run(auth_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    auth_retry = json.loads(subprocess.run(auth_args, env=record_env, capture_output=True, text=True, check=True).stdout)
    assert auth_result == auth_retry and not auth_result["transactionSubmission"]
    assert rpc("eth_getTransactionCount", [sender, "latest"]) == nonce_before_scan
    signing_test_env = dict(preparer_test_env, TG_MAINTENANCE_SIGNER_TEST_DSN=env["TG_INDEXER_DATABASE_URL"])
    subprocess.run(["go", "test", "-race", "./internal/maintenance", "-run", "^TestIsolatedMaintenanceSigningWorker$", "-count=1", "-v"], cwd=root, env=signing_test_env, check=True)
    # Sign exact prepared transactions on the isolated synthetic Anvil only.
    # The external fixture returns precomputed bytes and cannot submit a transaction.
    signing_outputs = {}
    for prepared_key in prepared_jobs:
        prepared_record = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--intent", prepared_key], env=record_env, capture_output=True, text=True, check=True).stdout)["record"]
        signed_response = rpc("eth_signTransaction", [dict(prepared_record["intent"]["call"], type="0x2", chainId=hex(46630))])
        signing_outputs[prepared_record["digest"]] = signed_response["raw"] if isinstance(signed_response, dict) else signed_response
    imported_raw = signing_outputs[recovered_intent["digest"]]
    recovery_file = data / "automatic-signing-recovered.hex"
    recovery_file.write_text(imported_raw)
    import_command = [str(root / "bin/maintenance-worker"), "--import-signature", str(recovery_file), "--job", recovered_key, "--intent-digest", recovered_intent["digest"], "--transaction-hash", rpc("web3_sha3", [imported_raw]), "--owner", "maintenance-preparer", "--token", auth_token, "--generation", str(recovered_intent["intent"]["reservation"]["generation"])]
    imported = json.loads(subprocess.run(import_command, env=record_env, capture_output=True, text=True, check=True).stdout)
    signer_program = data / "test-automatic-signer.py"
    signer_program.write_text("#!" + sys.executable + "\nimport json, sys\noutputs = " + repr(signing_outputs) + "\nprint(outputs[json.load(sys.stdin)['requestId']])\n")
    signer_program.chmod(0o700)
    signing_env = dict(prepare_env, TG_MAINTENANCE_SIGNER=str(signer_program))
    signing_command = [str(root / "bin/maintenance-signer"), "--once"]
    signed_jobs = []
    for _ in range(100):
        signed_result = json.loads(subprocess.run(signing_command, env=signing_env, capture_output=True, text=True, check=True).stdout)
        if signed_result["action"] == "idle":
            break
        assert signed_result["status"] == "signed_stored", signed_result
        signed_jobs.append(signed_result["jobKey"])
    else:
        raise AssertionError("signing queue did not drain")
    assert set(signed_jobs) == set(prepared_jobs), (signed_jobs, prepared_jobs)
    assert json.loads(subprocess.run(signing_command, env=signing_env, capture_output=True, text=True, check=True).stdout)["action"] == "idle"
    signing_daemon = subprocess.Popen([str(root / "bin/maintenance-signer"), "--run"], env=signing_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert json.loads(signing_daemon.stdout.readline())["action"] == "idle"
        signing_daemon.send_signal(signal.SIGTERM)
        _, errors = signing_daemon.communicate(timeout=10)
        assert signing_daemon.returncode == 0, errors
    finally:
        if signing_daemon.poll() is None:
            signing_daemon.kill()
            signing_daemon.wait()
    restart_env = dict(preparer_test_env, TG_MAINTENANCE_SIGNER_RESTART_DSN=env["TG_INDEXER_DATABASE_URL"])
    subprocess.run(["go", "test", "-race", "./internal/maintenance", "-run", "^TestIsolatedMaintenanceSigningWorkerRestart$", "-count=1", "-v"], cwd=root, env=restart_env, check=True)
    assert rpc("eth_getTransactionCount", [sender, "pending"]) == nonce_before_scan
    print("Automatic signing: unknown result imported, queue drained, restart reuses signed bytes, no broadcast", flush=True)
    submit_test_env = dict(preparer_test_env, TG_MAINTENANCE_SUBMITTER_TEST_DSN=env["TG_INDEXER_DATABASE_URL"])
    subprocess.run(["go", "test", "-race", "./internal/maintenance", "-run", "^TestIsolatedMaintenanceSubmissionWorker$", "-count=1", "-v"], cwd=root, env=submit_test_env, check=True)
    # Explicitly run the submitter against isolated synthetic Anvil only.
    submit_command = [str(root / "bin/maintenance-submitter"), "--once"]
    for _ in range(100):
        submit_response = subprocess.run(submit_command, env=prepare_env, capture_output=True, text=True)
        submit_result = json.loads(submit_response.stdout)
        if submit_result["action"] == "idle":
            assert submit_response.returncode == 0
            break
        assert submit_response.returncode == 0 and submit_result["status"] == "acknowledged", (submit_result, submit_response.stderr)
        persisted = json.loads(subprocess.run([str(root / "bin/maintenance-worker"), "--submission", submit_result["jobKey"]], env=record_env, capture_output=True, text=True, check=True).stdout)["submission"]
        assert persisted["transactionHash"] == submit_result["transactionHash"] and persisted["status"] == "acknowledged"
    else:
        raise AssertionError("submission queue did not drain")
    assert json.loads(subprocess.run(submit_command, env=prepare_env, capture_output=True, text=True, check=True).stdout)["action"] == "idle"
    submit_daemon = subprocess.Popen([str(root / "bin/maintenance-submitter"), "--run"], env=prepare_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert json.loads(submit_daemon.stdout.readline())["action"] == "idle"
        submit_daemon.send_signal(signal.SIGTERM)
        _, errors = submit_daemon.communicate(timeout=10)
        assert submit_daemon.returncode == 0, errors
    finally:
        if submit_daemon.poll() is None:
            submit_daemon.kill()
            submit_daemon.wait()
    print("Automatic submission: durable unknown recovery, queue drain, cross-process idle and SIGTERM passed", flush=True)
    budget_view = json.loads(subprocess.run([str(root / "bin/maintenance-budget"), "--inspect", "--manifest", str(preview_path), "--from", sender], env=budget_env, capture_output=True, text=True, check=True).stdout)["budget"]
    assert int(budget_view["allocated"]) > 0 and int(budget_view["allocated"]) <= int(budget_view["maximumTotal"])
    scan_test_env = dict(scan_env, TG_MAINTENANCE_SCAN_TEST_DSN=env["TG_INDEXER_DATABASE_URL"], TG_MAINTENANCE_TEST_MANIFEST=str(preview_path))
    subprocess.run(["go", "test", "-race", "./internal/maintenance", "-run", "^TestIsolatedMaintenanceScanner", "-count=1", "-v"], cwd=root, env=scan_test_env, check=True)

    # Swap addresses and their code identities to preserve runtime checks but break edges.
    manifest["contracts"][3]["address"], manifest["contracts"][4]["address"] = addresses[4], addresses[3]
    manifest["contracts"][3]["runtimeCodeHash"], manifest["contracts"][4]["runtimeCodeHash"] = manifest["contracts"][4]["runtimeCodeHash"], manifest["contracts"][3]["runtimeCodeHash"]
    path.write_text(json.dumps(manifest))
    result = subprocess.run(command, env=env, capture_output=True, text=True)
    assert result.returncode != 0 and "Factory core binding mismatch" in result.stderr
    print("Synthetic Anvil getter graph: core bindings, receipt-backed market discovery and swapped-root rejection passed", flush=True)
