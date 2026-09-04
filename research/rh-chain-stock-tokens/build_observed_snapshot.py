#!/usr/bin/env python3
"""Build a normalized RH Stock Token research snapshot from captured evidence.

This utility deliberately separates three evidence classes:

1. Robinhood's official asset directory (canonical identity metadata);
2. direct calls to the canonical Uniswap V2/V3 factories at one fixed block;
3. DexScreener address-search results (third-party discovery only).

The input pool captures are expected to have been produced at a fixed block by
the commands documented in this directory.  No third-party result is promoted
to an authoritative pool result by this script.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import shutil
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


CHAIN_ID = 4663
ASSET_API = "https://api.robinhood.com/rhj/assets"
PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com"
EXPLORER = "https://robinhoodchain.blockscout.com"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
NATIVE_ETH = ZERO_ADDRESS
QUOTE_ADDRESSES = {
    "USDG": USDG,
    "WETH": WETH,
}

UNISWAP_V2_FACTORY = "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f"
UNISWAP_V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"
UNISWAP_V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
V3_FEES = (100, 500, 3000, 10000)
V3_TICK_SPACING = {100: 1, 500: 10, 3000: 60, 10000: 200}

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
POOL_ID_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
UID_RE = POOL_ID_RE

V4_VERIFIED_EXAMPLES = {
    "0x054c27d231f83af8891157d238dfed61a02c2d15daa3854c4e0355c3ea3f0c28": {
        "pair": "CRM/USDG",
        "fee": 48730,
        "tickSpacing": 1,
        "initializeBlock": 53700392,
        "initializeTransaction": "0xcdf9c067d4059c53a96553214a3dfafcd7ea0554353090f6907c63e94814c3ac",
    },
    "0x5bfea5c46dd6576f995517ae8b349e6d5a0f7e248f2b8dcb4c150e43ec83b246": {
        "pair": "CRM/ETH",
        "fee": 49000,
        "tickSpacing": 490,
        "initializeBlock": 54111519,
        "initializeTransaction": "0x769f065123932545f73703a5081ec13049a2726f3c18a4252a07c825d34c56ce",
    },
}

CONTRACT_ARCHITECTURE = {
    "schemaVersion": 1,
    "architectureId": "RH_STOCK_SHARED_BEACON_2026_09_04",
    "chainId": CHAIN_ID,
    "observationBlock": {
        "number": 54348820,
        "hash": "0x934e85c2499f788c6515d5f2cb7fec156a2c2c19613ccc59db32ccee2a71d350",
        "timestamp": "2026-09-04T14:49:27+00:00",
    },
    "tokenProxyFleet": {
        "observedTokenCount": 194,
        "kind": "OPENZEPPELIN_BEACON_PROXY_WITH_SHARED_FIXED_BEACON",
        "runtimeBytes": 283,
        "runtimeKeccak256": "0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630",
        "allRuntimeFingerprintsMatched": True,
        "eip1967ImplementationSlotAllZero": True,
        "eip1967AdminSlotAllZero": True,
        "eip1967BeaconSlotAllMatchedSharedBeacon": True,
        "verifiedSourceExample": {
            "symbol": "CRM",
            "address": "0xd95b44124e475743a7589e68f3d74008a5536d44",
            "blockscoutMatch": "PARTIAL_MATCH_OPENZEPPELIN_BEACON_PROXY",
            "compiler": "v0.8.33+commit.64118f21",
            "evmVersion": "prague",
            "optimizerEnabled": True,
            "optimizerRuns": 200,
            "verifiedAt": "2026-07-30",
            "url": "https://robinhoodchain.blockscout.com/address/0xd95b44124e475743a7589e68f3d74008a5536d44?tab=contract",
        },
        "getterAuditDuringResearch": {
            "uidMatchesOfficialDirectory": "194/194",
            "decimalsEquals18": "194/194",
            "symbolMatchesOfficialDirectory": "194/194",
            "nameCallsSucceeded": "194/194",
            "perAssetPinnedEvidence": "spec/v1_rh_official_stock_catalog.snapshot.json",
        },
    },
    "sharedAccessControlsRegistryAndBeacon": {
        "address": "0xe10b6f6b275de231345c20d14ab812db62151b00",
        "runtimeBytes": 2332,
        "runtimeKeccak256": "0x8b465c0b53a2ba499566e9b4ca67d8c90ed6131743df806a570d156956a7e90e",
        "verifiedSource": {
            "match": "EXACT_MATCH",
            "contractName": "AccessControlsRegistry",
            "file": "src/AccessControlsRegistry.sol",
            "compiler": "v0.8.33+commit.64118f21",
            "evmVersion": "cancun",
            "optimizerEnabled": True,
            "optimizerRuns": 200,
            "verifiedAt": "2026-06-16T07:41:00",
            "url": "https://robinhoodchain.blockscout.com/address/0xe10b6f6b275de231345c20d14ab812db62151b00?tab=contract",
        },
        "capabilities": [
            "AccessControl role registry",
            "IBeacon implementation()",
            "BEACON_UPGRADER_ROLE-gated upgradeTo(address)",
            "PAUSER_ROLE-gated global pause/unpause",
            "BLOCKER_ROLE-gated shared address blocklist",
        ],
        "pausedAtSample": False,
    },
    "sharedStockImplementation": {
        "address": "0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2",
        "runtimeBytes": 11614,
        "runtimeKeccak256": "0xdc07e86ee482f99641bdafb9a0d772846b167401e094d90a666b94dbdcd1eec7",
        "registryConstructorArgument": "0xe10b6f6b275de231345c20d14ab812db62151b00",
        "verifiedSource": {
            "match": "EXACT_MATCH",
            "contractName": "Stock",
            "file": "src/Stock.sol",
            "compiler": "v0.8.33+commit.64118f21",
            "evmVersion": "cancun",
            "optimizerEnabled": True,
            "optimizerRuns": 200,
            "verifiedAt": "2026-06-16T07:47:14",
            "url": "https://robinhoodchain.blockscout.com/address/0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2?tab=contract",
        },
        "inheritance": [
            "IStock",
            "AccessControlled",
            "OraclePausable",
            "ERC20ScaledUIUpgradeable",
        ],
        "capabilities": [
            "ERC20 and EIP-2612 permit",
            "uid() and mutable display metadata",
            "ERC-8056 uiMultiplier with scheduled multiplier updates",
            "role-gated mint, burn, and adminBurn",
            "token-level and registry-global pause enforcement",
            "shared registry address blocklist enforcement",
            "separate oracle pause flag",
        ],
        "crmStateSample": {"paused": False, "tokenPaused": False},
    },
    "knownRoleHashes": {
        "MINTER_ROLE": "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
        "BURNER_ROLE": "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848",
        "PAUSER_ROLE": "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a",
        "BEACON_UPGRADER_ROLE": "0x5ab8bd28475e0dc8d5764e9ce50f85ffe2f14ec40c5b74e45f541485ad510c39",
        "MULTIPLIER_UPDATER_ROLE": "0x7158cf42e4a4f01c5456c8d75cdbd375748d45e9db7e812f5bcd18844122b615",
        "METADATA_UPDATER_ROLE": "0x7f5260842512b02356ff92de24be96e7e1aac2e234d9371b076ac2b4cddda61e",
        "ADMIN_BURNER_ROLE": "0x25e7ebc863fa4efd16243c82323b71f247c0cf439aca64c51b84a74afb738936",
        "TOKEN_PAUSER_ROLE": "0xe95e22ec6dbf4c911d1fae59680a3e9cb71dd35b3a1c697d232e4b01a8ff30a2",
        "ORACLE_PAUSER_ROLE": "0x155fc2c2b00b801014447f9d3a1522625740f8e592e4c0b0bb7c5867c150aa11",
    },
    "unresolved": [
        "Current members and operational custody of every privileged role were not resolved.",
        "All-token pause and blocklist state was not resampled because the public RPC rate-limited the scan.",
        "Role governance delay, multisig threshold, and incident process are not established by source shape alone.",
    ],
}


def _sha256_bytes(raw: bytes) -> str:
    return "0x" + hashlib.sha256(raw).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _copy_if_different(source: Path, destination: Path) -> None:
    if source.resolve() != destination.resolve():
        shutil.copy2(source, destination)


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": "TickerGarden-RH-Research/1.0"}
    )
    for attempt in range(8):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 7:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else 2 ** min(attempt, 5)
            time.sleep(min(delay, 30))
    raise AssertionError("unreachable")


def _iso_mtime(path: Path) -> str:
    return dt.datetime.fromtimestamp(
        path.stat().st_mtime, dt.timezone.utc
    ).replace(microsecond=0).isoformat()


def _address(value: Any, *, allow_zero: bool = False) -> str:
    if not isinstance(value, str) or not ADDRESS_RE.fullmatch(value):
        raise ValueError(f"invalid address: {value!r}")
    normalized = value.lower()
    if not allow_zero and normalized == ZERO_ADDRESS:
        raise ValueError("unexpected zero address")
    return normalized


def _asset_identity(asset: dict[str, Any]) -> dict[str, Any]:
    deployments = [
        item
        for item in asset.get("deployments", [])
        if item.get("chainId") == CHAIN_ID
    ]
    if len(deployments) != 1:
        raise ValueError(
            f"{asset.get('tokenSymbol')}: expected exactly one chain {CHAIN_ID} deployment"
        )
    uid = asset.get("id")
    if not isinstance(uid, str) or not UID_RE.fullmatch(uid):
        raise ValueError(f"{asset.get('tokenSymbol')}: invalid uid")
    decimals = asset.get("tokenDecimals")
    if not isinstance(decimals, int):
        raise ValueError(f"{asset.get('tokenSymbol')}: invalid tokenDecimals")
    return {
        "assetUid": uid.lower(),
        "symbol": asset.get("tokenSymbol"),
        "name": asset.get("tokenName"),
        "isin": asset.get("isin"),
        "stockToken": _address(deployments[0].get("contractAddress")),
        "chainId": CHAIN_ID,
        "decimals": decimals,
        "officialStatus": asset.get("status"),
        "currentMultiplier": asset.get("currentMultiplier"),
        "pendingMultiplier": asset.get("pendingMultiplier"),
        "pendingMultiplierEffectiveTime": asset.get(
            "pendingMultiplierEffectiveTime"
        ),
        "logoUrl": asset.get("logoUrl"),
        "tradingCapabilities": asset.get("tradingCapabilities"),
    }


def _normalize_assets(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_assets = payload.get("assets")
    if not isinstance(raw_assets, list):
        raise ValueError("official response has no assets array")
    assets = [_asset_identity(item) for item in raw_assets]
    assets.sort(key=lambda item: (str(item["symbol"]), item["assetUid"]))
    if not assets:
        raise ValueError("official directory returned no chain 4663 assets")
    for key in ("assetUid", "symbol", "stockToken"):
        values = [asset[key] for asset in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"duplicate official asset field: {key}")
    return assets


def _identity_tuple(asset: dict[str, Any]) -> tuple[Any, ...]:
    normalized = _asset_identity(asset)
    return (
        normalized["assetUid"],
        normalized["symbol"],
        normalized["name"],
        normalized["isin"],
        normalized["stockToken"],
        normalized["chainId"],
        normalized["decimals"],
        normalized["officialStatus"],
    )


def _catalog_diff(
    current_payload: dict[str, Any], previous_path: Path | None
) -> dict[str, Any] | None:
    if previous_path is None or not previous_path.exists():
        return None
    previous_payload = _load_json(previous_path)
    current_by_uid = {
        item["id"].lower(): item for item in current_payload.get("assets", [])
    }
    previous_by_uid = {
        item["id"].lower(): item for item in previous_payload.get("assets", [])
    }
    added = sorted(set(current_by_uid) - set(previous_by_uid))
    removed = sorted(set(previous_by_uid) - set(current_by_uid))
    identity_changes: list[dict[str, Any]] = []
    multiplier_changes: list[dict[str, Any]] = []
    for uid in sorted(set(current_by_uid) & set(previous_by_uid)):
        current = current_by_uid[uid]
        previous = previous_by_uid[uid]
        if _identity_tuple(current) != _identity_tuple(previous):
            identity_changes.append(
                {
                    "assetUid": uid,
                    "previous": _asset_identity(previous),
                    "current": _asset_identity(current),
                }
            )
        if current.get("currentMultiplier") != previous.get("currentMultiplier"):
            multiplier_changes.append(
                {
                    "assetUid": uid,
                    "symbol": current.get("tokenSymbol"),
                    "previous": previous.get("currentMultiplier"),
                    "current": current.get("currentMultiplier"),
                }
            )
    repository_root = Path(__file__).resolve().parents[2]
    try:
        previous_source = str(previous_path.resolve().relative_to(repository_root))
    except ValueError:
        previous_source = str(previous_path)
    return {
        "previousSource": previous_source,
        "previousCapturedAt": "2026-09-02T12:52:27+00:00",
        "addedAssetUids": added,
        "removedAssetUids": removed,
        "identityChangeCount": len(identity_changes),
        "identityChanges": identity_changes,
        "currentMultiplierChangeCount": len(multiplier_changes),
        "currentMultiplierChanges": multiplier_changes,
    }


def _expected_query_keys(assets: list[dict[str, Any]]) -> set[tuple[Any, ...]]:
    keys: set[tuple[Any, ...]] = set()
    for asset in assets:
        for quote in QUOTE_ADDRESSES:
            keys.add((asset["stockToken"], quote, "UNISWAP_V2", None))
            for fee in V3_FEES:
                keys.add((asset["stockToken"], quote, "UNISWAP_V3", fee))
    return keys


def _normalize_factory_queries(
    payload: dict[str, Any],
    assets: list[dict[str, Any]],
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    block = payload.get("block")
    calls = payload.get("calls")
    if not isinstance(block, int) or not isinstance(calls, list):
        raise ValueError("malformed factory capture")
    by_address = {asset["stockToken"]: asset for asset in assets}
    query_keys: set[tuple[Any, ...]] = set()
    normalized_queries: list[dict[str, Any]] = []
    pools: list[dict[str, Any]] = []
    for call in calls:
        kind = call.get("kind")
        venue = {"v2": "UNISWAP_V2", "v3": "UNISWAP_V3"}.get(kind)
        if venue is None:
            raise ValueError(f"unsupported factory query kind: {kind!r}")
        token = _address(call.get("token"))
        asset = by_address.get(token)
        if asset is None or call.get("symbol") != asset["symbol"]:
            raise ValueError(f"factory query is not tied to an official token: {call}")
        quote = call.get("quote")
        if quote not in QUOTE_ADDRESSES:
            raise ValueError(f"unsupported quote in factory capture: {quote!r}")
        fee = call.get("fee")
        if venue == "UNISWAP_V2":
            if fee is not None:
                raise ValueError("V2 factory query unexpectedly contains a fee")
            expected_factory = UNISWAP_V2_FACTORY
            expected_function = "getPair"
        else:
            if fee not in V3_FEES:
                raise ValueError(f"unexpected V3 fee tier: {fee!r}")
            expected_factory = UNISWAP_V3_FACTORY
            expected_function = "getPool"
        if _address(call.get("address")) != expected_factory:
            raise ValueError("factory address does not match official deployment")
        if call.get("functionName") != expected_function:
            raise ValueError("factory function does not match query kind")
        if call.get("error") is not None:
            raise ValueError(f"factory capture contains an RPC error: {call['error']}")
        result = _address(call.get("result"), allow_zero=True)
        key = (token, quote, venue, fee)
        if key in query_keys:
            raise ValueError(f"duplicate factory query: {key}")
        query_keys.add(key)
        record = {
            "venue": venue,
            "stockAssetUid": asset["assetUid"],
            "stockSymbol": asset["symbol"],
            "stockToken": token,
            "quoteSymbol": quote,
            "quoteToken": QUOTE_ADDRESSES[quote],
            "fee": fee,
            "factory": expected_factory,
            "function": expected_function,
            "result": result,
            "poolExistsAtObservationBlock": result != ZERO_ADDRESS,
        }
        normalized_queries.append(record)
        if result != ZERO_ADDRESS and venue == "UNISWAP_V2":
            currencies = sorted((token, QUOTE_ADDRESSES[quote]))
            pools.append(
                {
                    "venue": venue,
                    "poolAddress": result,
                    "poolId": None,
                    "stockAssetUid": asset["assetUid"],
                    "stockSymbol": asset["symbol"],
                    "stockToken": token,
                    "quoteSymbol": quote,
                    "quoteToken": QUOTE_ADDRESSES[quote],
                    "token0": currencies[0],
                    "token1": currencies[1],
                    "fee": 3000,
                    "tickSpacing": None,
                    "evidence": "CANONICAL_FACTORY_VIEW_AT_FIXED_BLOCK",
                }
            )
    expected = _expected_query_keys(assets)
    if query_keys != expected:
        raise ValueError(
            f"factory capture query coverage mismatch: missing={len(expected - query_keys)}, "
            f"unexpected={len(query_keys - expected)}"
        )
    normalized_queries.sort(
        key=lambda item: (
            item["stockSymbol"],
            item["venue"],
            item["quoteSymbol"],
            item["fee"] if item["fee"] is not None else -1,
        )
    )
    return block, normalized_queries, pools


def _normalize_v3_details(
    payload: dict[str, Any],
    observation_block: int,
    queries: list[dict[str, Any]],
    assets: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if payload.get("block") != observation_block:
        raise ValueError("V3 detail block does not match factory capture")
    raw_pools = payload.get("pools")
    if not isinstance(raw_pools, list):
        raise ValueError("V3 detail capture has no pools array")
    expected = {
        (
            query["stockToken"],
            query["quoteSymbol"],
            query["fee"],
            query["result"],
        )
        for query in queries
        if query["venue"] == "UNISWAP_V3"
        and query["poolExistsAtObservationBlock"]
    }
    by_address = {asset["stockToken"]: asset for asset in assets}
    seen: set[tuple[Any, ...]] = set()
    pools: list[dict[str, Any]] = []
    for raw in raw_pools:
        token = _address(raw.get("token"))
        asset = by_address.get(token)
        quote = raw.get("quote")
        fee = raw.get("fee")
        pool = _address(raw.get("result"))
        key = (token, quote, fee, pool)
        if asset is None or quote not in QUOTE_ADDRESSES or key not in expected:
            raise ValueError(f"unexpected V3 pool detail: {key}")
        if key in seen:
            raise ValueError(f"duplicate V3 pool detail: {key}")
        seen.add(key)
        detail = raw.get("detail")
        if not isinstance(detail, dict):
            raise ValueError(f"missing V3 detail: {key}")
        detail_fee = int(detail.get("fee"))
        tick_spacing = int(detail.get("tickSpacing"))
        token0 = _address(detail.get("token0"))
        token1 = _address(detail.get("token1"))
        if detail_fee != fee or tick_spacing != V3_TICK_SPACING[fee]:
            raise ValueError(f"V3 fee/tick spacing mismatch: {key}")
        if {token0, token1} != {token, QUOTE_ADDRESSES[quote]}:
            raise ValueError(f"V3 token pair mismatch: {key}")
        pools.append(
            {
                "venue": "UNISWAP_V3",
                "poolAddress": pool,
                "poolId": None,
                "stockAssetUid": asset["assetUid"],
                "stockSymbol": asset["symbol"],
                "stockToken": token,
                "quoteSymbol": quote,
                "quoteToken": QUOTE_ADDRESSES[quote],
                "token0": token0,
                "token1": token1,
                "fee": fee,
                "tickSpacing": tick_spacing,
                "evidence": "CANONICAL_FACTORY_VIEW_AND_POOL_STATE_AT_FIXED_BLOCK",
            }
        )
    if seen != expected:
        raise ValueError(
            f"V3 details do not cover all nonzero factory results: "
            f"missing={len(expected - seen)}, unexpected={len(seen - expected)}"
        )
    return pools


def _standard_counterparty(
    pair: dict[str, Any], stock_token: str
) -> tuple[str, str] | None:
    base = _address(pair.get("baseToken", {}).get("address"), allow_zero=True)
    quote = _address(pair.get("quoteToken", {}).get("address"), allow_zero=True)
    if stock_token not in {base, quote}:
        raise ValueError("DexScreener result does not contain the queried token")
    counterparty = quote if base == stock_token else base
    symbol_by_address = {USDG: "USDG", WETH: "WETH", NATIVE_ETH: "ETH"}
    symbol = symbol_by_address.get(counterparty)
    if symbol is None:
        return None
    return symbol, counterparty


def _normalize_dexscreener(
    payload: list[dict[str, Any]],
    assets: list[dict[str, Any]],
    canonical_pools: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, str]]:
    if not isinstance(payload, list) or len(payload) != len(assets):
        raise ValueError("DexScreener capture does not cover every official address request")
    by_symbol = {asset["symbol"]: asset for asset in assets}
    seen_symbols: set[str] = set()
    request_status: dict[str, str] = {}
    records: list[dict[str, Any]] = []
    canonical_by_address = {
        pool["poolAddress"]: pool
        for pool in canonical_pools
        if pool.get("poolAddress") is not None
    }
    pair_occurrences: Counter[tuple[str, str, str]] = Counter()
    raw_pair_occurrences: Counter[str] = Counter()
    raw_pair_count = 0
    raw_pair_missing_labels_count = 0
    raw_stock_as_base_count = 0
    raw_stock_as_quote_count = 0
    for entry in payload:
        symbol = entry.get("symbol")
        asset = by_symbol.get(symbol)
        if asset is None or symbol in seen_symbols:
            raise ValueError(f"invalid or duplicate DexScreener symbol: {symbol!r}")
        seen_symbols.add(symbol)
        if _address(entry.get("address")) != asset["stockToken"]:
            raise ValueError(f"DexScreener token mismatch for {symbol}")
        error = entry.get("error")
        if error is not None:
            request_status[symbol] = str(error)
            continue
        pairs = entry.get("pairs")
        if not isinstance(pairs, list):
            raise ValueError(f"DexScreener success has no pairs array for {symbol}")
        request_status[symbol] = "OK" if pairs else "OK_EMPTY"
        for pair in pairs:
            if pair.get("chainId") != "robinhood":
                continue
            raw_pair_count += 1
            raw_identifier = pair.get("pairAddress")
            if isinstance(raw_identifier, str):
                raw_pair_occurrences[raw_identifier.lower()] += 1
            if not pair.get("labels"):
                raw_pair_missing_labels_count += 1
            base_address = _address(
                pair.get("baseToken", {}).get("address"), allow_zero=True
            )
            if base_address == asset["stockToken"]:
                raw_stock_as_base_count += 1
            else:
                raw_stock_as_quote_count += 1
            counterparty = _standard_counterparty(pair, asset["stockToken"])
            if counterparty is None:
                continue
            quote_symbol, quote_token = counterparty
            labels = pair.get("labels") or []
            if not isinstance(labels, list):
                raise ValueError("DexScreener labels must be an optional array")
            version = labels[0] if labels else None
            pair_id = pair.get("pairAddress")
            if not isinstance(pair_id, str):
                raise ValueError("DexScreener pairAddress is missing")
            is_uniswap_v4 = pair.get("dexId") == "uniswap" and version == "v4"
            if is_uniswap_v4:
                if not POOL_ID_RE.fullmatch(pair_id):
                    raise ValueError(f"invalid Uniswap V4 pool id: {pair_id!r}")
                address_kind = "POOL_ID_BYTES32"
                normalized_pair_id = pair_id.lower()
            else:
                normalized_pair_id = _address(pair_id)
                address_kind = "CONTRACT_ADDRESS"
            canonical = canonical_by_address.get(normalized_pair_id)
            canonical_match = (
                pair.get("dexId") == "uniswap"
                and version in {"v2", "v3"}
                and canonical is not None
                and canonical["stockToken"] == asset["stockToken"]
                and canonical["quoteToken"] == quote_token
            )
            verified_v4 = V4_VERIFIED_EXAMPLES.get(normalized_pair_id)
            if canonical_match:
                evidence = "MATCHED_CANONICAL_UNISWAP_FACTORY_RESULT"
            elif verified_v4 is not None:
                evidence = "V4_INITIALIZE_LOG_EXAMPLE_VERIFIED"
            else:
                evidence = "THIRD_PARTY_DISCOVERY_ONLY"
            record = {
                "stockAssetUid": asset["assetUid"],
                "stockSymbol": symbol,
                "stockToken": asset["stockToken"],
                "quoteSymbol": quote_symbol,
                "quoteToken": quote_token,
                "dexId": pair.get("dexId"),
                "labels": labels,
                "version": version,
                "pairIdentifier": normalized_pair_id,
                "pairIdentifierKind": address_kind,
                "url": pair.get("url"),
                "evidence": evidence,
                "verifiedV4Initialize": verified_v4,
                "dynamicSnapshot": {
                    "priceNative": pair.get("priceNative"),
                    "priceUsd": pair.get("priceUsd"),
                    "transactions": pair.get("txns"),
                    "volume": pair.get("volume"),
                    "priceChange": pair.get("priceChange"),
                    "liquidity": pair.get("liquidity"),
                    "fdv": pair.get("fdv"),
                    "marketCap": pair.get("marketCap"),
                    "pairCreatedAt": pair.get("pairCreatedAt"),
                },
            }
            records.append(record)
            pair_occurrences[(str(pair.get("dexId")), str(version), normalized_pair_id)] += 1
    if seen_symbols != set(by_symbol):
        raise ValueError("DexScreener capture is missing official symbols")
    records.sort(
        key=lambda item: (
            item["stockSymbol"],
            str(item["dexId"]),
            str(item["version"]),
            item["pairIdentifier"],
        )
    )
    duplicated = [
        {"dexId": key[0], "version": key[1], "pairIdentifier": key[2], "occurrences": count}
        for key, count in sorted(pair_occurrences.items())
        if count > 1
    ]
    coverage = {
        "addressRequestCount": len(payload),
        "successfulRequestCount": sum(value in {"OK", "OK_EMPTY"} for value in request_status.values()),
        "successfulRequestsWithAnyRawPair": sum(value == "OK" for value in request_status.values()),
        "successfulEmptyRequestCount": sum(value == "OK_EMPTY" for value in request_status.values()),
        "http429RequestCount": sum("429" in value for value in request_status.values()),
        "rawRobinhoodPairRecordCount": raw_pair_count,
        "rawStockAsBaseRecordCount": raw_stock_as_base_count,
        "rawStockAsQuoteRecordCount": raw_stock_as_quote_count,
        "rawPairRecordMissingLabelsCount": raw_pair_missing_labels_count,
        "rawDuplicatePairIdentifiers": [
            {"pairIdentifier": identifier, "occurrences": count}
            for identifier, count in sorted(raw_pair_occurrences.items())
            if count > 1
        ],
        "standardQuoteDiscoveryRecordCount": len(records),
        "uniqueStandardQuoteDiscoveryIdentifierCount": len(pair_occurrences),
        "duplicateDiscoveryIdentifiers": duplicated,
        "coveredOfficialStockCount": len({record["stockToken"] for record in records}),
        "countByDex": dict(sorted(Counter(str(record["dexId"]) for record in records).items())),
        "countByVersion": dict(sorted(Counter(str(record["version"]) for record in records).items())),
        "countByEvidence": dict(sorted(Counter(record["evidence"] for record in records).items())),
    }
    return records, coverage, request_status


def _write_asset_csv(
    path: Path,
    assets: list[dict[str, Any]],
    canonical_pools: list[dict[str, Any]],
    discovery_records: list[dict[str, Any]],
    request_status: dict[str, str],
) -> None:
    canonical_by_asset: dict[str, list[dict[str, Any]]] = defaultdict(list)
    discovery_by_asset: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for pool in canonical_pools:
        canonical_by_asset[pool["stockToken"]].append(pool)
    for record in discovery_records:
        discovery_by_asset[record["stockToken"]].append(record)
    fields = [
        "symbol",
        "name",
        "isin",
        "asset_uid",
        "token_address",
        "chain_id",
        "decimals",
        "official_status",
        "current_multiplier",
        "pending_multiplier",
        "uniswap_v2_standard_pool_count",
        "uniswap_v3_standard_pool_count",
        "third_party_standard_quote_record_count",
        "dexscreener_request_status",
        "logo_url",
    ]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for asset in assets:
            pools = canonical_by_asset[asset["stockToken"]]
            discoveries = discovery_by_asset[asset["stockToken"]]
            writer.writerow(
                {
                    "symbol": asset["symbol"],
                    "name": asset["name"],
                    "isin": asset["isin"],
                    "asset_uid": asset["assetUid"],
                    "token_address": asset["stockToken"],
                    "chain_id": asset["chainId"],
                    "decimals": asset["decimals"],
                    "official_status": asset["officialStatus"],
                    "current_multiplier": asset["currentMultiplier"],
                    "pending_multiplier": asset["pendingMultiplier"],
                    "uniswap_v2_standard_pool_count": sum(
                        pool["venue"] == "UNISWAP_V2" for pool in pools
                    ),
                    "uniswap_v3_standard_pool_count": sum(
                        pool["venue"] == "UNISWAP_V3" for pool in pools
                    ),
                    "third_party_standard_quote_record_count": len(discoveries),
                    "dexscreener_request_status": request_status[asset["symbol"]],
                    "logo_url": asset["logoUrl"],
                }
            )


def _write_pool_csv(path: Path, pools: list[dict[str, Any]]) -> None:
    fields = [
        "venue",
        "pool_address",
        "stock_symbol",
        "stock_asset_uid",
        "stock_token",
        "quote_symbol",
        "quote_token",
        "token0",
        "token1",
        "fee",
        "tick_spacing",
        "evidence",
    ]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for pool in pools:
            writer.writerow(
                {
                    "venue": pool["venue"],
                    "pool_address": pool["poolAddress"],
                    "stock_symbol": pool["stockSymbol"],
                    "stock_asset_uid": pool["stockAssetUid"],
                    "stock_token": pool["stockToken"],
                    "quote_symbol": pool["quoteSymbol"],
                    "quote_token": pool["quoteToken"],
                    "token0": pool["token0"],
                    "token1": pool["token1"],
                    "fee": pool["fee"],
                    "tick_spacing": pool["tickSpacing"],
                    "evidence": pool["evidence"],
                }
            )


def _write_discovery_csv(path: Path, records: list[dict[str, Any]]) -> None:
    fields = [
        "stock_symbol",
        "stock_asset_uid",
        "stock_token",
        "quote_symbol",
        "quote_token",
        "dex_id",
        "version",
        "pair_identifier",
        "pair_identifier_kind",
        "evidence",
        "liquidity_usd_at_capture",
        "volume_h24_at_capture",
        "url",
    ]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for record in records:
            dynamic = record["dynamicSnapshot"]
            liquidity = dynamic.get("liquidity") or {}
            volume = dynamic.get("volume") or {}
            writer.writerow(
                {
                    "stock_symbol": record["stockSymbol"],
                    "stock_asset_uid": record["stockAssetUid"],
                    "stock_token": record["stockToken"],
                    "quote_symbol": record["quoteSymbol"],
                    "quote_token": record["quoteToken"],
                    "dex_id": record["dexId"],
                    "version": record["version"],
                    "pair_identifier": record["pairIdentifier"],
                    "pair_identifier_kind": record["pairIdentifierKind"],
                    "evidence": record["evidence"],
                    "liquidity_usd_at_capture": liquidity.get("usd"),
                    "volume_h24_at_capture": volume.get("h24"),
                    "url": record["url"],
                }
            )


def build(arguments: argparse.Namespace) -> dict[str, Any]:
    captured_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    official_raw = (
        arguments.official_assets.read_bytes()
        if arguments.official_assets is not None
        else _fetch(ASSET_API)
    )
    official_payload = json.loads(official_raw)
    assets = _normalize_assets(official_payload)

    factory_payload = _load_json(arguments.factory_calls)
    v3_payload = _load_json(arguments.v3_details)
    dex_source = _load_json(arguments.dexscreener)
    if isinstance(dex_source, dict) and isinstance(dex_source.get("records"), list):
        dex_payload = dex_source["records"]
        dex_source_captured_at = dex_source.get("capturedAt") or _iso_mtime(
            arguments.dexscreener
        )
    else:
        dex_payload = dex_source
        dex_source_captured_at = _iso_mtime(arguments.dexscreener)
    observation_block, queries, v2_pools = _normalize_factory_queries(
        factory_payload, assets
    )
    observation_block_hash = (
        arguments.observation_block_hash or factory_payload.get("blockHash")
    )
    observation_block_timestamp = (
        arguments.observation_block_timestamp
        or factory_payload.get("blockTimestamp")
    )
    if not isinstance(observation_block_hash, str) or not re.fullmatch(
        r"0x[0-9a-fA-F]{64}", observation_block_hash
    ):
        raise ValueError(
            "observation block hash is missing/invalid; provide it in the capture or via --observation-block-hash"
        )
    if not isinstance(observation_block_timestamp, str):
        raise ValueError(
            "observation block timestamp is missing; provide it in the capture or via --observation-block-timestamp"
        )
    finalized_by_tag = factory_payload.get("blockTagRequested") == "finalized"
    finalized_by_proof = (
        arguments.finalized_proof_block is not None
        and arguments.finalized_proof_block >= observation_block
    )
    v3_pools = _normalize_v3_details(
        v3_payload, observation_block, queries, assets
    )
    canonical_pools = sorted(
        v2_pools + v3_pools,
        key=lambda item: (
            item["stockSymbol"],
            item["venue"],
            item["quoteSymbol"],
            item["fee"],
        ),
    )
    discovery_records, discovery_coverage, request_status = _normalize_dexscreener(
        dex_payload, assets, canonical_pools
    )
    catalog_diff = _catalog_diff(official_payload, arguments.previous_official_source)

    asset_pool_counts: dict[str, Counter[str]] = defaultdict(Counter)
    asset_discovery_counts: Counter[str] = Counter()
    for pool in canonical_pools:
        asset_pool_counts[pool["stockToken"]][pool["venue"]] += 1
    for record in discovery_records:
        asset_discovery_counts[record["stockToken"]] += 1
    reference_assets: list[dict[str, Any]] = []
    for asset in assets:
        reference_assets.append(
            {
                **asset,
                "contractArchitectureId": "RH_STOCK_SHARED_BEACON_2026_09_04",
                "poolCoverage": {
                    "canonicalUniswapV2StandardQuotePoolCount": asset_pool_counts[
                        asset["stockToken"]
                    ]["UNISWAP_V2"],
                    "canonicalUniswapV3StandardQuotePoolCount": asset_pool_counts[
                        asset["stockToken"]
                    ]["UNISWAP_V3"],
                    "dexscreenerStandardQuoteDiscoveryRecordCount": asset_discovery_counts[
                        asset["stockToken"]
                    ],
                    "dexscreenerRequestStatus": request_status[asset["symbol"]],
                },
            }
        )

    v2_assets = {pool["stockToken"] for pool in canonical_pools if pool["venue"] == "UNISWAP_V2"}
    v3_assets = {pool["stockToken"] for pool in canonical_pools if pool["venue"] == "UNISWAP_V3"}
    reference = {
        "schemaVersion": 1,
        "kind": "ROBINHOOD_CHAIN_STOCK_TOKEN_RESEARCH_REFERENCE",
        "capturedAt": captured_at,
        "chain": {
            "name": "Robinhood Chain",
            "chainId": CHAIN_ID,
            "publicRpc": PUBLIC_RPC,
            "explorer": EXPLORER,
            "poolObservationBlock": {
                "number": observation_block,
                "hash": observation_block_hash.lower(),
                "timestamp": observation_block_timestamp,
                "confirmedFinalizedAtCapture": finalized_by_tag or finalized_by_proof,
                "finalizedProofBlockNumber": arguments.finalized_proof_block,
            },
        },
        "sources": {
            "officialAssetApi": ASSET_API,
            "officialAssetCaptureMode": (
                "ARCHIVED_INPUT" if arguments.official_assets is not None else "LIVE_FETCH"
            ),
            "officialAssetResponseBytes": len(official_raw),
            "officialAssetResponseSha256": _sha256_bytes(official_raw),
            "officialContractsPage": "https://docs.robinhood.com/chain/contracts/",
            "officialStockTokenDocs": "https://docs.robinhood.com/chain/stock-tokens/",
            "officialStockTokenApiDocs": "https://docs.robinhood.com/chain/stock-token-apis/",
            "uniswapDeploymentManifest": "https://github.com/Uniswap/contracts/blob/main/deployments/4663.md",
            "dexscreenerApi": "https://api.dexscreener.com/latest/dex/tokens/{token}",
        },
        "summary": {
            "officialAssetCount": len(assets),
            "officialStatusCounts": dict(
                sorted(Counter(asset["officialStatus"] for asset in assets).items())
            ),
            "decimalsCounts": dict(
                sorted(Counter(str(asset["decimals"]) for asset in assets).items())
            ),
            "canonicalFactoryQueryCount": len(queries),
            "canonicalFactoryQueryErrorCount": 0,
            "canonicalUniswapV2StandardQuotePoolCount": len(v2_pools),
            "canonicalUniswapV2CoveredAssetCount": len(v2_assets),
            "canonicalUniswapV3StandardQuotePoolCount": len(v3_pools),
            "canonicalUniswapV3CoveredAssetCount": len(v3_assets),
            "canonicalUniswapV3NoStandardQuotePoolSymbols": sorted(
                asset["symbol"]
                for asset in assets
                if asset["stockToken"] not in v3_assets
            ),
            "canonicalV3FeeCounts": dict(
                sorted(Counter(str(pool["fee"]) for pool in v3_pools).items())
            ),
            "dexscreenerCoverage": discovery_coverage,
        },
        "catalogDiffFrom2026_09_02": catalog_diff,
        "poolQueryScope": {
            "authoritativeScope": {
                "venues": ["UNISWAP_V2", "UNISWAP_V3"],
                "quotes": ["USDG", "WETH"],
                "v3Fees": list(V3_FEES),
                "method": "getPair/getPool via canonical factories at the fixed block",
            },
            "thirdPartyDiscoveryScope": {
                "provider": "DexScreener",
                "quotes": ["USDG", "WETH", "ETH"],
                "isAuthoritative": False,
                "rateLimitedRequestCount": discovery_coverage["http429RequestCount"],
            },
            "notCovered": [
                "all possible quote assets",
                "complete Uniswap V4 Initialize-log enumeration",
                "complete non-Uniswap factory enumeration",
                "RFQ, proprietary AMM, orderbook, mint/redemption liquidity",
                "current executable route quality or slippage",
            ],
        },
        "interpretationBoundary": {
            "isProtocolAllowList": False,
            "isProductionAdmissionProof": False,
            "poolExistenceMeansCurrentLiquidity": False,
            "dexscreenerNotFoundMeansNoPool": False,
            "dynamicFields": [
                "currentMultiplier",
                "pendingMultiplier",
                "tradingCapabilities",
                "DexScreener price/liquidity/volume",
                "Beacon implementation and role assignments",
            ],
        },
        "assets": reference_assets,
    }

    output = arguments.output_dir
    output.mkdir(parents=True, exist_ok=True)
    official_source = output / "official-assets.source.json"
    official_source.write_bytes(official_raw)
    _copy_if_different(
        arguments.factory_calls,
        output / "uniswap-standard-factory-calls.source.json",
    )
    _copy_if_different(
        arguments.v3_details,
        output / "uniswap-v3-details.source.json",
    )
    _copy_if_different(
        arguments.dexscreener, output / "dexscreener-address-scan.source.json"
    )
    _write_json(output / "contract-architecture.json", CONTRACT_ARCHITECTURE)
    _write_json(output / "stock-token-reference.json", reference)
    _write_json(
        output / "uniswap-standard-queries.json",
        {
            "schemaVersion": 1,
            "observationBlockNumber": observation_block,
            "scope": f"{len(assets)} official Stock Tokens x USDG/WETH x V2 plus four V3 fee tiers",
            "queries": queries,
        },
    )
    _write_json(
        output / "uniswap-standard-pools.json",
        {
            "schemaVersion": 1,
            "observationBlockNumber": observation_block,
            "poolCount": len(canonical_pools),
            "pools": canonical_pools,
        },
    )
    _write_json(
        output / "dexscreener-standard-quote-discovery.json",
        {
            "schemaVersion": 1,
            "sourceCapturedAt": dex_source_captured_at,
            "coverage": discovery_coverage,
            "interpretation": "THIRD_PARTY_DISCOVERY_ONLY_EXCEPT_EXPLICIT_MATCHES",
            "records": discovery_records,
        },
    )
    _write_asset_csv(
        output / "stock-tokens.csv",
        assets,
        canonical_pools,
        discovery_records,
        request_status,
    )
    _write_pool_csv(output / "uniswap-standard-pools.csv", canonical_pools)
    _write_discovery_csv(
        output / "dexscreener-standard-quote-discovery.csv", discovery_records
    )

    artifact_names = [
        "official-assets.source.json",
        "uniswap-standard-factory-calls.source.json",
        "uniswap-v3-details.source.json",
        "dexscreener-address-scan.source.json",
        "contract-architecture.json",
        "stock-token-reference.json",
        "stock-tokens.csv",
        "uniswap-standard-queries.json",
        "uniswap-standard-pools.json",
        "uniswap-standard-pools.csv",
        "dexscreener-standard-quote-discovery.json",
        "dexscreener-standard-quote-discovery.csv",
    ]
    manifest = {
        "schemaVersion": 1,
        "builtAt": captured_at,
        "generators": [
            {
                "path": str(path.relative_to(Path(__file__).resolve().parents[2])),
                "sha256": _sha256_file(path),
            }
            for path in (
                Path(__file__).resolve(),
                Path(__file__).resolve().parent / "capture_standard_pools.mjs",
                Path(__file__).resolve().parent / "capture_snapshot.py",
            )
        ],
        "inputCaptureTimestamps": {
            "factoryCalls": _iso_mtime(arguments.factory_calls),
            "v3Details": _iso_mtime(arguments.v3_details),
            "dexscreener": _iso_mtime(arguments.dexscreener),
        },
        "validation": {
            "officialAssetCount": len(assets),
            "expectedFactoryQueryCount": len(_expected_query_keys(assets)),
            "observedFactoryQueryCount": len(queries),
            "factoryQueryErrors": 0,
            "v3NonzeroResultDetailSetMatched": True,
            "dexscreenerAddressRequestsMatchedOfficialCatalog": True,
        },
        "files": [
            {
                "path": name,
                "bytes": (output / name).stat().st_size,
                "sha256": _sha256_file(output / name),
            }
            for name in artifact_names
        ],
    }
    _write_json(output / "manifest.json", manifest)
    return reference


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--factory-calls", type=Path, required=True)
    parser.add_argument("--v3-details", type=Path, required=True)
    parser.add_argument("--dexscreener", type=Path, required=True)
    parser.add_argument(
        "--official-assets",
        type=Path,
        help="Use an archived official /assets response instead of fetching live data",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent
        / "snapshots"
        / dt.date.today().isoformat(),
    )
    parser.add_argument(
        "--previous-official-source",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "spec"
        / "v1_rh_official_stock_catalog.source.json",
    )
    parser.add_argument(
        "--observation-block-hash",
        default=None,
    )
    parser.add_argument(
        "--observation-block-timestamp",
        default=None,
    )
    parser.add_argument("--finalized-proof-block", type=int)
    arguments = parser.parse_args()
    if (
        arguments.observation_block_hash is not None
        and not arguments.observation_block_hash.startswith("0x")
    ):
        parser.error("observation block hash must be 0x-prefixed")
    result = build(arguments)
    print(
        json.dumps(
            {
                "outputDir": str(arguments.output_dir),
                "summary": result["summary"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
