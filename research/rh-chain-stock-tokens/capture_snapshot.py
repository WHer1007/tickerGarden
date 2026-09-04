#!/usr/bin/env python3
"""Capture a reproducible Robinhood Chain Stock Token research snapshot.

The collector intentionally uses only Python's standard library plus the
repository's existing Keccak helper.  It pins every RPC read to one block,
verifies the official directory against the token contracts, and indexes
Stock Token pools created by the canonical Uniswap V2/V3/V4 deployments.

This is research evidence, not a production allow-list.  Production admission
must still run the protocol preflight at its own finalized block.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from spec.generate_v1_hash_vectors import keccak256  # noqa: E402


CHAIN_ID = 4663
ASSET_API = "https://api.robinhood.com/rhj/assets"
DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com"
EXPLORER = "https://robinhoodchain.blockscout.com"
UNISWAP_DEPLOYMENTS = "https://github.com/Uniswap/contracts/blob/main/deployments/4663.md"
USER_AGENT = "TickerGarden-RH-Stock-Research/1.0"

HEX_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
HEX_32 = re.compile(r"^0x[0-9a-fA-F]{64}$")

WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
NATIVE = "0x0000000000000000000000000000000000000000"
STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b"

DEX_DEPLOYMENTS: dict[str, dict[str, str]] = {
    "UNISWAP_V2": {
        "factory": "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f",
        "deploymentTransaction": "0x2fc08b6c72d5f2120cec9f3be8ed0b45c210d51adbc87f33b2135886681edaf7",
        "event": "PairCreated(address,address,address,uint256)",
    },
    "UNISWAP_V3": {
        "factory": "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
        "deploymentTransaction": "0x8add72fbcad4bf7732336de35dcd06b582c1501d0832c4710a30850a7cff8977",
        "event": "PoolCreated(address,address,uint24,int24,address)",
    },
    "UNISWAP_V4": {
        "poolManager": "0x8366a39cc670b4001a1121b8f6a443a643e40951",
        "deploymentTransaction": "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
        "event": "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)",
    },
}

IMMUTABLE_BEACON_SUFFIX = bytes.fromhex("6001600160a01b0316635c60da1b")


def _keccak_hex(raw: bytes) -> str:
    return "0x" + keccak256(raw).hex()


def _selector(signature: str) -> str:
    return _keccak_hex(signature.encode())[:10]


def _topic(signature: str) -> str:
    return _keccak_hex(signature.encode())


SELECTORS = {
    "decimals": _selector("decimals()"),
    "uid": _selector("uid()"),
    "uiMultiplier": _selector("uiMultiplier()"),
    "totalSupply": _selector("totalSupply()"),
    "tokenPaused": _selector("tokenPaused()"),
    "oraclePaused": _selector("oraclePaused()"),
    "paused": _selector("paused()"),
    "implementation": _selector("implementation()"),
    "symbol": _selector("symbol()"),
    "name": _selector("name()"),
    "v2Reserves": _selector("getReserves()"),
    "v3Liquidity": _selector("liquidity()"),
    "v3Slot0": _selector("slot0()"),
    "v4Liquidity": _selector("getLiquidity(bytes32)"),
    "v4Slot0": _selector("getSlot0(bytes32)"),
}


class RpcError(RuntimeError):
    def __init__(self, method: str, error: Any):
        super().__init__(f"{method}: {error}")
        self.method = method
        self.error = error


@dataclass
class RpcStats:
    http_requests: int = 0
    rpc_calls: int = 0
    retries: int = 0
    log_segments: int = 0
    log_splits: int = 0


class RpcClient:
    def __init__(self, url: str, request_interval: float) -> None:
        self.url = url
        self.request_interval = request_interval
        self._last_request = 0.0
        self._next_id = 1
        self.stats = RpcStats()

    def _wait_for_slot(self) -> None:
        wait = self.request_interval - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)

    def _post(self, payload: Any) -> Any:
        body = json.dumps(payload, separators=(",", ":")).encode()
        headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
        for attempt in range(10):
            self._wait_for_slot()
            request = urllib.request.Request(self.url, data=body, headers=headers)
            self._last_request = time.monotonic()
            self.stats.http_requests += 1
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    return json.loads(response.read())
            except urllib.error.HTTPError as error:
                if error.code not in {429, 500, 502, 503, 504} or attempt == 9:
                    raise
                retry_after = error.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else 2 ** min(attempt, 5)
                except ValueError:
                    delay = 2 ** min(attempt, 5)
                self.stats.retries += 1
                time.sleep(min(max(delay, self.request_interval), 30))
            except urllib.error.URLError:
                if attempt == 9:
                    raise
                self.stats.retries += 1
                time.sleep(min(2 ** min(attempt, 5), 30))
        raise AssertionError("unreachable")

    def call(self, method: str, params: list[Any]) -> Any:
        request_id = self._next_id
        self._next_id += 1
        self.stats.rpc_calls += 1
        response = self._post(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        )
        if not isinstance(response, dict) or response.get("id") != request_id:
            raise RpcError(method, "mismatched JSON-RPC response")
        if "error" in response:
            raise RpcError(method, response["error"])
        if "result" not in response:
            raise RpcError(method, "missing result")
        return response["result"]

    def batch(
        self, calls: list[tuple[str, list[Any], str]], batch_size: int
    ) -> dict[str, dict[str, Any]]:
        output: dict[str, dict[str, Any]] = {}
        for offset in range(0, len(calls), batch_size):
            chunk = calls[offset : offset + batch_size]
            payload: list[dict[str, Any]] = []
            by_id: dict[int, tuple[str, str]] = {}
            for method, params, label in chunk:
                request_id = self._next_id
                self._next_id += 1
                by_id[request_id] = (method, label)
                payload.append(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": method,
                        "params": params,
                    }
                )
            self.stats.rpc_calls += len(payload)
            response = self._post(payload)
            if not isinstance(response, list):
                response = [response]
            seen: set[int] = set()
            for item in response:
                request_id = item.get("id") if isinstance(item, dict) else None
                if request_id not in by_id:
                    continue
                seen.add(request_id)
                method, label = by_id[request_id]
                if "error" in item:
                    output[label] = {"error": item["error"], "method": method}
                elif "result" in item:
                    output[label] = {"result": item["result"], "method": method}
                else:
                    output[label] = {"error": "missing result", "method": method}
            for request_id, (method, label) in by_id.items():
                if request_id not in seen:
                    output[label] = {"error": "response omitted id", "method": method}
        return output


def _get_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
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


def _quantity(value: int) -> str:
    return hex(value)


def _words(value: Any) -> list[str]:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise ValueError("result is not hex")
    raw = value[2:]
    if len(raw) % 64:
        raise ValueError("result is not whole ABI words")
    return [raw[index : index + 64] for index in range(0, len(raw), 64)]


def _uint(value: Any) -> int:
    words = _words(value)
    if len(words) != 1:
        raise ValueError("expected one ABI word")
    return int(words[0], 16)


def _bool(value: Any) -> bool:
    number = _uint(value)
    if number not in {0, 1}:
        raise ValueError("expected ABI bool")
    return number == 1


def _address_word(word: str) -> str:
    return "0x" + word[-40:].lower()


def _address_result(value: Any) -> str:
    words = _words(value)
    if len(words) != 1:
        raise ValueError("expected one address word")
    return _address_word(words[0])


def _signed_word(word: str, bits: int = 256) -> int:
    value = int(word, 16)
    if value >= 1 << (bits - 1):
        value -= 1 << bits
    return value


def _signed_low(word: str, bits: int) -> int:
    value = int(word, 16) & ((1 << bits) - 1)
    if value >= 1 << (bits - 1):
        value -= 1 << bits
    return value


def _abi_string(value: Any) -> str:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise ValueError("not hex")
    raw = bytes.fromhex(value[2:])
    if len(raw) == 32:
        return raw.rstrip(b"\x00").decode("utf-8", errors="replace")
    if len(raw) < 64:
        raise ValueError("short dynamic string")
    offset = int.from_bytes(raw[:32], "big")
    if offset + 32 > len(raw):
        raise ValueError("invalid string offset")
    length = int.from_bytes(raw[offset : offset + 32], "big")
    start = offset + 32
    if start + length > len(raw):
        raise ValueError("invalid string length")
    return raw[start : start + length].decode("utf-8", errors="replace")


def _runtime_evidence(value: Any) -> dict[str, Any]:
    if not isinstance(value, str) or value in {"0x", "0x0"}:
        return {"runtimeBytes": 0, "runtimeKeccak256": None}
    raw = bytes.fromhex(value[2:])
    return {"runtimeBytes": len(raw), "runtimeKeccak256": _keccak_hex(raw)}


def _immutable_beacon(value: Any) -> str | None:
    if not isinstance(value, str) or not value.startswith("0x"):
        return None
    raw = bytes.fromhex(value[2:])
    candidates: set[str] = set()
    limit = max(0, len(raw) - 1 - 32 - len(IMMUTABLE_BEACON_SUFFIX) + 1)
    for offset in range(limit):
        if raw[offset] != 0x7F:
            continue
        immediate = raw[offset + 1 : offset + 33]
        suffix = raw[offset + 33 : offset + 33 + len(IMMUTABLE_BEACON_SUFFIX)]
        if immediate[:12] == bytes(12) and suffix == IMMUTABLE_BEACON_SUFFIX:
            address = "0x" + immediate[12:].hex()
            if int(address, 16):
                candidates.add(address)
    if len(candidates) > 1:
        raise ValueError("multiple immutable beacon candidates in proxy runtime")
    return next(iter(candidates), None)


def _stock_topic(address: str) -> str:
    return "0x" + "0" * 24 + address[2:].lower()


def _normalize_assets(payload: dict[str, Any], limit: int | None) -> list[dict[str, Any]]:
    source_assets = payload.get("assets")
    if not isinstance(source_assets, list) or not source_assets:
        raise ValueError("official directory omitted assets")
    normalized: list[dict[str, Any]] = []
    for source in source_assets:
        uid = source.get("id")
        if not isinstance(uid, str) or not HEX_32.fullmatch(uid):
            raise ValueError("invalid asset UID")
        deployments = [
            item
            for item in source.get("deployments", [])
            if item.get("chainId") == CHAIN_ID
        ]
        if len(deployments) != 1:
            raise ValueError(f"{uid} has {len(deployments)} chain {CHAIN_ID} deployments")
        token = deployments[0].get("contractAddress")
        if not isinstance(token, str) or not HEX_ADDRESS.fullmatch(token):
            raise ValueError(f"{uid} has invalid token address")
        decimals = source.get("tokenDecimals")
        if not isinstance(decimals, int):
            raise ValueError(f"{uid} has invalid decimals")
        normalized.append(
            {
                "assetUid": uid.lower(),
                "symbol": source.get("tokenSymbol"),
                "name": source.get("tokenName"),
                "isin": source.get("isin"),
                "stockToken": token.lower(),
                "decimals": decimals,
                "officialStatus": source.get("status"),
                "currentMultiplier": source.get("currentMultiplier"),
                "pendingMultiplier": source.get("pendingMultiplier"),
                "pendingMultiplierEffectiveTime": source.get(
                    "pendingMultiplierEffectiveTime"
                ),
                "logoUrl": source.get("logoUrl"),
                "tradingCapabilities": source.get("tradingCapabilities"),
                "onchain": {},
                "poolIds": [],
            }
        )
    normalized.sort(key=lambda item: (str(item["symbol"]), item["assetUid"]))
    if len({item["assetUid"] for item in normalized}) != len(normalized):
        raise ValueError("duplicate official UID")
    if len({item["stockToken"] for item in normalized}) != len(normalized):
        raise ValueError("duplicate canonical token address")
    if limit is not None:
        normalized = normalized[:limit]
    return normalized


def _block_snapshot(rpc: RpcClient, tag: str) -> dict[str, Any]:
    chain_id = int(rpc.call("eth_chainId", []), 16)
    if chain_id != CHAIN_ID:
        raise ValueError(f"RPC chain ID {chain_id}, expected {CHAIN_ID}")
    block = rpc.call("eth_getBlockByNumber", [tag, False])
    if not isinstance(block, dict):
        raise ValueError(f"RPC returned no block for {tag}")
    return {
        "number": int(block["number"], 16),
        "numberHex": block["number"].lower(),
        "hash": block["hash"].lower(),
        "timestamp": int(block["timestamp"], 16),
        "timestampIso": dt.datetime.fromtimestamp(
            int(block["timestamp"], 16), dt.timezone.utc
        ).isoformat(),
        "requestedTag": tag,
        "isFinalizedTag": tag == "finalized",
    }


def _result_value(
    responses: dict[str, dict[str, Any]], label: str, decoder: Any
) -> tuple[Any, Any | None]:
    response = responses.get(label)
    if response is None:
        return None, "missing response"
    if "error" in response:
        return None, response["error"]
    try:
        return decoder(response["result"]), None
    except (TypeError, ValueError) as error:
        return None, str(error)


def _verify_tokens(
    rpc: RpcClient, assets: list[dict[str, Any]], block_tag: str, batch_size: int
) -> dict[str, Any]:
    calls: list[tuple[str, list[Any], str]] = []
    for index, asset in enumerate(assets):
        token = asset["stockToken"]
        for field, method, data in (
            ("code", "eth_getCode", None),
            ("uid", "eth_call", SELECTORS["uid"]),
            ("decimals", "eth_call", SELECTORS["decimals"]),
            ("uiMultiplier", "eth_call", SELECTORS["uiMultiplier"]),
            ("totalSupply", "eth_call", SELECTORS["totalSupply"]),
            ("tokenPaused", "eth_call", SELECTORS["tokenPaused"]),
            ("oraclePaused", "eth_call", SELECTORS["oraclePaused"]),
        ):
            params = [token, block_tag] if method == "eth_getCode" else [
                {"to": token, "data": data},
                block_tag,
            ]
            calls.append((method, params, f"asset:{index}:{field}"))
    responses = rpc.batch(calls, batch_size)

    runtime_counts: Counter[str] = Counter()
    beacon_counts: Counter[str] = Counter()
    check_failures: list[dict[str, Any]] = []
    for index, asset in enumerate(assets):
        prefix = f"asset:{index}:"
        code, code_error = _result_value(responses, prefix + "code", lambda value: value)
        uid, uid_error = _result_value(
            responses,
            prefix + "uid",
            lambda value: "0x" + _words(value)[0].lower(),
        )
        decimals, decimals_error = _result_value(
            responses, prefix + "decimals", _uint
        )
        multiplier, multiplier_error = _result_value(
            responses, prefix + "uiMultiplier", _uint
        )
        total_supply, supply_error = _result_value(
            responses, prefix + "totalSupply", _uint
        )
        token_paused, token_paused_error = _result_value(
            responses, prefix + "tokenPaused", _bool
        )
        oracle_paused, oracle_paused_error = _result_value(
            responses, prefix + "oraclePaused", _bool
        )
        runtime = _runtime_evidence(code) if not code_error else {
            "runtimeBytes": None,
            "runtimeKeccak256": None,
        }
        beacon = _immutable_beacon(code) if not code_error else None
        if runtime["runtimeKeccak256"]:
            runtime_counts[runtime["runtimeKeccak256"]] += 1
        if beacon:
            beacon_counts[beacon] += 1
        rest_multiplier = asset.get("currentMultiplier")
        expected_multiplier = None
        if isinstance(rest_multiplier, str) and re.fullmatch(r"\d+\.\d+", rest_multiplier):
            whole, fractional = rest_multiplier.split(".", 1)
            expected_multiplier = int(whole) * 10**18 + int(
                (fractional + "0" * 18)[:18]
            )
        checks = {
            "hasRuntimeCode": not code_error and runtime["runtimeBytes"] not in {None, 0},
            "uidMatchesOfficialDirectory": not uid_error
            and uid == asset["assetUid"],
            "decimalsMatchOfficialDirectory": not decimals_error
            and decimals == asset["decimals"],
            "restMultiplierMatchesPinnedBlock": multiplier_error is None
            and expected_multiplier is not None
            and multiplier == expected_multiplier,
            "immutableBeaconRecognized": beacon is not None,
        }
        errors = {
            key: value
            for key, value in {
                "code": code_error,
                "uid": uid_error,
                "decimals": decimals_error,
                "uiMultiplier": multiplier_error,
                "totalSupply": supply_error,
                "tokenPaused": token_paused_error,
                "oraclePaused": oracle_paused_error,
            }.items()
            if value is not None
        }
        asset["onchain"] = {
            **runtime,
            "uid": uid,
            "decimals": decimals,
            "uiMultiplierRaw": str(multiplier) if multiplier is not None else None,
            "totalSupplyRaw": str(total_supply) if total_supply is not None else None,
            "tokenPaused": token_paused,
            "oraclePaused": oracle_paused,
            "proxyKind": "IMMUTABLE_BEACON_PROXY" if beacon else "UNRECOGNIZED",
            "beacon": beacon,
            "checks": checks,
            "readErrors": errors,
        }
        failed_required = [
            key
            for key in (
                "hasRuntimeCode",
                "uidMatchesOfficialDirectory",
                "decimalsMatchOfficialDirectory",
                "immutableBeaconRecognized",
            )
            if not checks[key]
        ]
        if failed_required:
            check_failures.append(
                {"assetUid": asset["assetUid"], "symbol": asset["symbol"], "checks": failed_required}
            )

    beacons: list[dict[str, Any]] = []
    implementations: dict[str, dict[str, Any]] = {}
    for beacon, asset_count in sorted(beacon_counts.items()):
        code = rpc.call("eth_getCode", [beacon, block_tag])
        implementation = _address_result(
            rpc.call(
                "eth_call",
                [{"to": beacon, "data": SELECTORS["implementation"]}, block_tag],
            )
        )
        implementation_code = rpc.call("eth_getCode", [implementation, block_tag])
        global_paused = _bool(
            rpc.call(
                "eth_call",
                [{"to": beacon, "data": SELECTORS["paused"]}, block_tag],
            )
        )
        beacons.append(
            {
                "address": beacon,
                "assetCount": asset_count,
                **_runtime_evidence(code),
                "implementation": implementation,
                "globalPaused": global_paused,
                "role": "COMBINED_ACCESS_CONTROLS_REGISTRY_AND_I_BEACON",
            }
        )
        implementations[implementation] = {
            "address": implementation,
            **_runtime_evidence(implementation_code),
        }
    for asset in assets:
        beacon = asset["onchain"].get("beacon")
        match = next((item for item in beacons if item["address"] == beacon), None)
        asset["onchain"]["implementation"] = match["implementation"] if match else None

    return {
        "runtimeClusters": [
            {"runtimeKeccak256": key, "assetCount": count}
            for key, count in sorted(runtime_counts.items())
        ],
        "beacons": beacons,
        "implementations": list(implementations.values()),
        "requiredIdentityFailureCount": len(check_failures),
        "requiredIdentityFailures": check_failures,
    }


def _scan_logs(
    rpc: RpcClient,
    address: str,
    topics: list[Any],
    from_block: int,
    to_block: int,
    chunk_blocks: int,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []

    def scan(start: int, end: int) -> None:
        result: Any = None
        last_error: RpcError | None = None
        for attempt in range(3):
            rpc.stats.log_segments += 1
            try:
                result = rpc.call(
                    "eth_getLogs",
                    [
                        {
                            "address": address,
                            "fromBlock": _quantity(start),
                            "toBlock": _quantity(end),
                            "topics": topics,
                        }
                    ],
                )
                last_error = None
                break
            except RpcError as error:
                last_error = error
                message = str(error.error).lower()
                should_split = any(
                    marker in message
                    for marker in ("timeout", "timed out", "exceeds limit", "too many")
                )
                transient = any(
                    marker in message
                    for marker in (
                        "eof",
                        "temporarily unavailable",
                        "connection reset",
                        "internal error",
                        "context deadline",
                    )
                )
                if transient and not should_split and attempt < 2:
                    rpc.stats.retries += 1
                    time.sleep(2 ** attempt)
                    continue
                if (should_split or transient) and start < end:
                    middle = (start + end) // 2
                    rpc.stats.log_splits += 1
                    scan(start, middle)
                    scan(middle + 1, end)
                    return
                raise
        if last_error is not None:
            raise last_error
        if not isinstance(result, list):
            raise ValueError("eth_getLogs result was not a list")
        output.extend(result)

    cursor = from_block
    while cursor <= to_block:
        end = min(cursor + chunk_blocks - 1, to_block)
        scan(cursor, end)
        cursor = end + 1
    return output


def _deployment_blocks(rpc: RpcClient) -> dict[str, int]:
    output: dict[str, int] = {}
    for name, deployment in DEX_DEPLOYMENTS.items():
        receipt = rpc.call(
            "eth_getTransactionReceipt", [deployment["deploymentTransaction"]]
        )
        if not isinstance(receipt, dict) or not receipt.get("blockNumber"):
            raise ValueError(f"no deployment receipt for {name}")
        output[name] = int(receipt["blockNumber"], 16)
    return output


def _dedupe_logs(logs: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for log in logs:
        key = (str(log.get("transactionHash")), str(log.get("logIndex")))
        by_key[key] = log
    return sorted(
        by_key.values(),
        key=lambda log: (
            int(log.get("blockNumber", "0x0"), 16),
            int(log.get("transactionIndex", "0x0"), 16),
            int(log.get("logIndex", "0x0"), 16),
        ),
    )


def _decode_pool_log(venue: str, log: dict[str, Any]) -> dict[str, Any]:
    topics = log["topics"]
    words = _words(log.get("data", "0x"))
    common = {
        "venue": venue,
        "eventAddress": log["address"].lower(),
        "createdBlock": int(log["blockNumber"], 16),
        "createdTransaction": log["transactionHash"].lower(),
        "logIndex": int(log["logIndex"], 16),
    }
    if venue == "UNISWAP_V2":
        if len(topics) != 3 or len(words) < 2:
            raise ValueError("malformed V2 PairCreated log")
        pair = _address_word(words[0])
        return {
            **common,
            "poolKey": f"UNISWAP_V2:{pair}",
            "poolAddress": pair,
            "poolId": None,
            "currency0": _address_word(topics[1][2:]),
            "currency1": _address_word(topics[2][2:]),
            "fee": 3000,
            "tickSpacing": None,
            "hooks": None,
            "factorySequence": int(words[1], 16),
        }
    if venue == "UNISWAP_V3":
        if len(topics) != 4 or len(words) < 2:
            raise ValueError("malformed V3 PoolCreated log")
        pool = _address_word(words[1])
        return {
            **common,
            "poolKey": f"UNISWAP_V3:{pool}",
            "poolAddress": pool,
            "poolId": None,
            "currency0": _address_word(topics[1][2:]),
            "currency1": _address_word(topics[2][2:]),
            "fee": int(topics[3], 16),
            "tickSpacing": _signed_low(words[0], 24),
            "hooks": None,
        }
    if venue == "UNISWAP_V4":
        if len(topics) != 4 or len(words) < 5:
            raise ValueError("malformed V4 Initialize log")
        pool_id = topics[1].lower()
        return {
            **common,
            "poolKey": f"UNISWAP_V4:{pool_id}",
            "poolAddress": None,
            "poolId": pool_id,
            "currency0": _address_word(topics[2][2:]),
            "currency1": _address_word(topics[3][2:]),
            "fee": int(words[0], 16),
            "tickSpacing": _signed_low(words[1], 24),
            "hooks": _address_word(words[2]),
            "initialSqrtPriceX96": str(int(words[3], 16)),
            "initialTick": _signed_word(words[4]),
        }
    raise ValueError(f"unknown venue {venue}")


def _discover_pools(
    rpc: RpcClient,
    assets: list[dict[str, Any]],
    block: dict[str, Any],
    chunk_blocks: int,
    batch_size: int,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, dict[str, Any]]]:
    deployment_blocks = _deployment_blocks(rpc)
    stock_topics = [_stock_topic(asset["stockToken"]) for asset in assets]
    event_logs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for venue, deployment in DEX_DEPLOYMENTS.items():
        event_topic = _topic(deployment["event"])
        address = deployment.get("factory") or deployment["poolManager"]
        if venue == "UNISWAP_V4":
            filters = [
                [event_topic, None, stock_topics],
                [event_topic, None, None, stock_topics],
            ]
        else:
            filters = [[event_topic, stock_topics], [event_topic, None, stock_topics]]
        for topics in filters:
            event_logs[venue].extend(
                _scan_logs(
                    rpc,
                    address,
                    topics,
                    deployment_blocks[venue],
                    block["number"],
                    chunk_blocks,
                )
            )

    pools: list[dict[str, Any]] = []
    for venue, logs in event_logs.items():
        pools.extend(_decode_pool_log(venue, log) for log in _dedupe_logs(logs))
    by_pool_key = {pool["poolKey"]: pool for pool in pools}
    if len(by_pool_key) != len(pools):
        raise ValueError("duplicate pool keys after log deduplication")
    pools.sort(key=lambda pool: (pool["createdBlock"], pool["venue"], pool["poolKey"]))

    stock_by_address = {asset["stockToken"]: asset for asset in assets}
    for pool in pools:
        stock_assets = [
            stock_by_address[address]
            for address in (pool["currency0"], pool["currency1"])
            if address in stock_by_address
        ]
        pool["stockAssets"] = [
            {
                "assetUid": asset["assetUid"],
                "symbol": asset["symbol"],
                "stockToken": asset["stockToken"],
            }
            for asset in stock_assets
        ]
        for asset in stock_assets:
            asset["poolIds"].append(pool["poolKey"])

    metadata: dict[str, dict[str, Any]] = {
        NATIVE: {"address": NATIVE, "symbol": "ETH", "name": "Native ETH", "decimals": 18},
        WETH: {"address": WETH, "symbol": "WETH", "name": "Wrapped Ether", "decimals": 18},
        USDG: {"address": USDG, "symbol": "USDG", "name": "Global Dollar", "decimals": 6},
    }
    for asset in assets:
        metadata[asset["stockToken"]] = {
            "address": asset["stockToken"],
            "symbol": asset["symbol"],
            "name": asset["name"],
            "decimals": asset["decimals"],
            "officialStockAssetUid": asset["assetUid"],
        }
    unknown = sorted(
        {
            address
            for pool in pools
            for address in (pool["currency0"], pool["currency1"])
            if address not in metadata
        }
    )
    metadata_calls: list[tuple[str, list[Any], str]] = []
    for index, address in enumerate(unknown):
        for field in ("symbol", "name", "decimals"):
            metadata_calls.append(
                (
                    "eth_call",
                    [{"to": address, "data": SELECTORS[field]}, block["numberHex"]],
                    f"metadata:{index}:{field}",
                )
            )
    metadata_responses = rpc.batch(metadata_calls, batch_size) if metadata_calls else {}
    for index, address in enumerate(unknown):
        symbol, symbol_error = _result_value(
            metadata_responses, f"metadata:{index}:symbol", _abi_string
        )
        name, name_error = _result_value(
            metadata_responses, f"metadata:{index}:name", _abi_string
        )
        decimals, decimals_error = _result_value(
            metadata_responses, f"metadata:{index}:decimals", _uint
        )
        metadata[address] = {
            "address": address,
            "symbol": symbol,
            "name": name,
            "decimals": decimals,
            "readErrors": {
                key: value
                for key, value in {
                    "symbol": symbol_error,
                    "name": name_error,
                    "decimals": decimals_error,
                }.items()
                if value is not None
            },
        }

    state_calls: list[tuple[str, list[Any], str]] = []
    for index, pool in enumerate(pools):
        if pool["venue"] == "UNISWAP_V2":
            state_calls.extend(
                [
                    (
                        "eth_getCode",
                        [pool["poolAddress"], block["numberHex"]],
                        f"pool:{index}:code",
                    ),
                    (
                        "eth_call",
                        [{"to": pool["poolAddress"], "data": SELECTORS["v2Reserves"]}, block["numberHex"]],
                        f"pool:{index}:reserves",
                    ),
                ]
            )
        elif pool["venue"] == "UNISWAP_V3":
            state_calls.extend(
                [
                    (
                        "eth_getCode",
                        [pool["poolAddress"], block["numberHex"]],
                        f"pool:{index}:code",
                    ),
                    (
                        "eth_call",
                        [{"to": pool["poolAddress"], "data": SELECTORS["v3Liquidity"]}, block["numberHex"]],
                        f"pool:{index}:liquidity",
                    ),
                    (
                        "eth_call",
                        [{"to": pool["poolAddress"], "data": SELECTORS["v3Slot0"]}, block["numberHex"]],
                        f"pool:{index}:slot0",
                    ),
                ]
            )
        else:
            calldata_suffix = pool["poolId"][2:]
            state_calls.extend(
                [
                    (
                        "eth_call",
                        [{"to": STATE_VIEW, "data": SELECTORS["v4Liquidity"] + calldata_suffix}, block["numberHex"]],
                        f"pool:{index}:liquidity",
                    ),
                    (
                        "eth_call",
                        [{"to": STATE_VIEW, "data": SELECTORS["v4Slot0"] + calldata_suffix}, block["numberHex"]],
                        f"pool:{index}:slot0",
                    ),
                ]
            )
    state_responses = rpc.batch(state_calls, batch_size) if state_calls else {}
    for index, pool in enumerate(pools):
        state: dict[str, Any] = {}
        errors: dict[str, Any] = {}
        if pool["venue"] == "UNISWAP_V2":
            code, code_error = _result_value(
                state_responses, f"pool:{index}:code", lambda value: value
            )
            reserves, reserve_error = _result_value(
                state_responses, f"pool:{index}:reserves", _words
            )
            state.update(_runtime_evidence(code) if code_error is None else {})
            if reserves and len(reserves) >= 3:
                state.update(
                    {
                        "reserve0Raw": str(int(reserves[0], 16)),
                        "reserve1Raw": str(int(reserves[1], 16)),
                        "lastBlockTimestamp": int(reserves[2], 16),
                        "hasCurrentLiquidity": int(reserves[0], 16) > 0
                        and int(reserves[1], 16) > 0,
                    }
                )
            if code_error is not None:
                errors["code"] = code_error
            if reserve_error is not None:
                errors["reserves"] = reserve_error
        else:
            liquidity, liquidity_error = _result_value(
                state_responses, f"pool:{index}:liquidity", _uint
            )
            slot0, slot0_error = _result_value(
                state_responses, f"pool:{index}:slot0", _words
            )
            state["activeLiquidityAtCurrentTickRaw"] = (
                str(liquidity) if liquidity is not None else None
            )
            state["hasCurrentActiveLiquidity"] = (
                liquidity > 0 if liquidity is not None else None
            )
            if slot0 and len(slot0) >= 2:
                state["sqrtPriceX96"] = str(int(slot0[0], 16))
                state["currentTick"] = _signed_word(slot0[1])
                if pool["venue"] == "UNISWAP_V4" and len(slot0) >= 4:
                    state["protocolFee"] = int(slot0[2], 16)
                    state["lpFee"] = int(slot0[3], 16)
            if pool["venue"] == "UNISWAP_V3":
                code, code_error = _result_value(
                    state_responses, f"pool:{index}:code", lambda value: value
                )
                state.update(_runtime_evidence(code) if code_error is None else {})
                if code_error is not None:
                    errors["code"] = code_error
            if liquidity_error is not None:
                errors["liquidity"] = liquidity_error
            if slot0_error is not None:
                errors["slot0"] = slot0_error
        state["readErrors"] = errors
        pool["stateAtObservationBlock"] = state
        pool["currency0Metadata"] = metadata[pool["currency0"]]
        pool["currency1Metadata"] = metadata[pool["currency1"]]

    coverage = {
        "source": UNISWAP_DEPLOYMENTS,
        "venues": {
            name: {
                **deployment,
                "eventTopic0": _topic(deployment["event"]),
                "deploymentBlock": deployment_blocks[name],
                "scanToBlock": block["number"],
                "completeEventRangeScan": True,
            }
            for name, deployment in DEX_DEPLOYMENTS.items()
        },
        "scope": "CANONICAL_UNISWAP_V2_V3_V4_CREATION_EVENTS_INVOLVING_ANY_CURRENT_OFFICIAL_STOCK_TOKEN",
        "notCovered": [
            "Non-Uniswap AMMs or private/permissioned/RFQ liquidity",
            "Pools created after the pinned observation block",
            "Pool positions outside the current tick when active liquidity is zero",
            "Trading volume and router-level fills",
        ],
    }
    return pools, coverage, metadata


def _pool_is_liquid(pool: dict[str, Any]) -> bool:
    state = pool.get("stateAtObservationBlock", {})
    if pool["venue"] == "UNISWAP_V2":
        return state.get("hasCurrentLiquidity") is True
    return state.get("hasCurrentActiveLiquidity") is True


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def _write_asset_csv(path: Path, assets: list[dict[str, Any]], pools: list[dict[str, Any]]) -> None:
    pool_by_key = {pool["poolKey"]: pool for pool in pools}
    fieldnames = [
        "symbol",
        "name",
        "isin",
        "asset_uid",
        "token_address",
        "decimals",
        "official_status",
        "current_multiplier",
        "total_supply_raw",
        "token_paused",
        "oracle_paused",
        "runtime_keccak256",
        "beacon",
        "implementation",
        "pool_count",
        "uniswap_v2_pool_count",
        "uniswap_v3_pool_count",
        "uniswap_v4_pool_count",
        "current_liquid_pool_count",
    ]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        for asset in assets:
            related = [pool_by_key[key] for key in asset["poolIds"]]
            venue_counts = Counter(pool["venue"] for pool in related)
            writer.writerow(
                {
                    "symbol": asset["symbol"],
                    "name": asset["name"],
                    "isin": asset["isin"],
                    "asset_uid": asset["assetUid"],
                    "token_address": asset["stockToken"],
                    "decimals": asset["decimals"],
                    "official_status": asset["officialStatus"],
                    "current_multiplier": asset["currentMultiplier"],
                    "total_supply_raw": asset["onchain"].get("totalSupplyRaw"),
                    "token_paused": asset["onchain"].get("tokenPaused"),
                    "oracle_paused": asset["onchain"].get("oraclePaused"),
                    "runtime_keccak256": asset["onchain"].get("runtimeKeccak256"),
                    "beacon": asset["onchain"].get("beacon"),
                    "implementation": asset["onchain"].get("implementation"),
                    "pool_count": len(related),
                    "uniswap_v2_pool_count": venue_counts["UNISWAP_V2"],
                    "uniswap_v3_pool_count": venue_counts["UNISWAP_V3"],
                    "uniswap_v4_pool_count": venue_counts["UNISWAP_V4"],
                    "current_liquid_pool_count": sum(_pool_is_liquid(pool) for pool in related),
                }
            )


def _write_pool_csv(path: Path, pools: list[dict[str, Any]]) -> None:
    fieldnames = [
        "venue",
        "pool_key",
        "pool_address",
        "pool_id",
        "stock_symbols",
        "currency0",
        "currency0_symbol",
        "currency1",
        "currency1_symbol",
        "fee",
        "tick_spacing",
        "hooks",
        "created_block",
        "created_transaction",
        "current_liquidity_raw",
        "reserve0_raw",
        "reserve1_raw",
        "has_current_liquidity",
    ]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        for pool in pools:
            state = pool["stateAtObservationBlock"]
            writer.writerow(
                {
                    "venue": pool["venue"],
                    "pool_key": pool["poolKey"],
                    "pool_address": pool["poolAddress"],
                    "pool_id": pool["poolId"],
                    "stock_symbols": ";".join(
                        item["symbol"] for item in pool["stockAssets"]
                    ),
                    "currency0": pool["currency0"],
                    "currency0_symbol": pool["currency0Metadata"].get("symbol"),
                    "currency1": pool["currency1"],
                    "currency1_symbol": pool["currency1Metadata"].get("symbol"),
                    "fee": pool["fee"],
                    "tick_spacing": pool["tickSpacing"],
                    "hooks": pool["hooks"],
                    "created_block": pool["createdBlock"],
                    "created_transaction": pool["createdTransaction"],
                    "current_liquidity_raw": state.get("activeLiquidityAtCurrentTickRaw"),
                    "reserve0_raw": state.get("reserve0Raw"),
                    "reserve1_raw": state.get("reserve1Raw"),
                    "has_current_liquidity": _pool_is_liquid(pool),
                }
            )


def _sha256(path: Path) -> str:
    return "0x" + hashlib.sha256(path.read_bytes()).hexdigest()


def capture(arguments: argparse.Namespace) -> dict[str, Any]:
    captured_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    source_raw = _get_bytes(ASSET_API)
    source_payload = json.loads(source_raw)
    assets = _normalize_assets(source_payload, arguments.asset_limit)
    rpc = RpcClient(arguments.rpc_url, arguments.request_interval)
    block = _block_snapshot(rpc, arguments.block_tag)
    contract_evidence = _verify_tokens(
        rpc, assets, block["numberHex"], arguments.batch_size
    )
    pools, dex_coverage, currency_metadata = _discover_pools(
        rpc,
        assets,
        block,
        arguments.log_chunk_blocks,
        arguments.batch_size,
    )
    confirmation = rpc.call("eth_getBlockByNumber", [block["numberHex"], False])
    if not isinstance(confirmation, dict) or confirmation.get("hash", "").lower() != block["hash"]:
        raise ValueError("observation block hash could not be reconfirmed")

    status_counts = Counter(asset["officialStatus"] for asset in assets)
    decimals_counts = Counter(str(asset["decimals"]) for asset in assets)
    venue_counts = Counter(pool["venue"] for pool in pools)
    liquid_counts = Counter(pool["venue"] for pool in pools if _pool_is_liquid(pool))
    with_pools = [asset for asset in assets if asset["poolIds"]]
    with_liquid_pools = [
        asset
        for asset in assets
        if any(
            _pool_is_liquid(pool)
            for pool in pools
            if pool["poolKey"] in asset["poolIds"]
        )
    ]
    identity_payload = [
        {
            key: asset[key]
            for key in ("assetUid", "stockToken", "decimals", "symbol", "name", "isin", "officialStatus")
        }
        for asset in sorted(assets, key=lambda item: item["assetUid"])
    ]
    result = {
        "schemaVersion": 1,
        "kind": "ROBINHOOD_CHAIN_OFFICIAL_STOCK_TOKEN_RESEARCH_SNAPSHOT",
        "capturedAt": captured_at,
        "captureMode": "LIMITED_SMOKE_TEST" if arguments.asset_limit else "FULL_CURRENT_DIRECTORY",
        "source": {
            "officialAssetApi": ASSET_API,
            "officialTokenContractsPage": "https://docs.robinhood.com/chain/contracts/",
            "officialStockTokenDocs": "https://docs.robinhood.com/chain/stock-tokens/",
            "officialStockTokenApiDocs": "https://docs.robinhood.com/chain/stock-token-apis/",
            "responseBytes": len(source_raw),
            "responseSha256": "0x" + hashlib.sha256(source_raw).hexdigest(),
            "identityKeccak256": _keccak_hex(
                json.dumps(identity_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            ),
        },
        "chain": {
            "name": "Robinhood Chain",
            "chainId": CHAIN_ID,
            "rpc": arguments.rpc_url,
            "explorer": EXPLORER,
            "observationBlock": block,
        },
        "summary": {
            "assetCount": len(assets),
            "uniqueAssetUidCount": len({asset["assetUid"] for asset in assets}),
            "uniqueTokenAddressCount": len({asset["stockToken"] for asset in assets}),
            "statusCounts": dict(sorted(status_counts.items())),
            "decimalsCounts": dict(sorted(decimals_counts.items())),
            "identityFailureCount": contract_evidence["requiredIdentityFailureCount"],
            "tokenPausedCount": sum(
                asset["onchain"].get("tokenPaused") is True for asset in assets
            ),
            "oraclePausedCount": sum(
                asset["onchain"].get("oraclePaused") is True for asset in assets
            ),
            "poolCount": len(pools),
            "poolCountByVenue": dict(sorted(venue_counts.items())),
            "currentLiquidPoolCount": sum(_pool_is_liquid(pool) for pool in pools),
            "currentLiquidPoolCountByVenue": dict(sorted(liquid_counts.items())),
            "assetsWithAnyCoveredPool": len(with_pools),
            "assetsWithCurrentLiquidityInCoveredPools": len(with_liquid_pools),
        },
        "contractArchitecture": contract_evidence,
        "dexCoverage": dex_coverage,
        "currencyMetadata": [currency_metadata[key] for key in sorted(currency_metadata)],
        "assets": assets,
        "pools": pools,
        "captureStats": {
            "httpRequests": rpc.stats.http_requests,
            "rpcCalls": rpc.stats.rpc_calls,
            "retryCount": rpc.stats.retries,
            "logQuerySegments": rpc.stats.log_segments,
            "logQuerySplits": rpc.stats.log_splits,
        },
        "interpretationBoundary": {
            "isProtocolAllowList": False,
            "isProductionAdmissionProof": False,
            "poolNotFoundMeansNoPoolAnywhere": False,
            "zeroCurrentTickLiquidityMeansNoPositionExists": False,
            "dynamicFields": [
                "currentMultiplier",
                "pendingMultiplier",
                "pendingMultiplierEffectiveTime",
                "tradingCapabilities",
                "totalSupplyRaw",
                "pause flags",
                "Beacon implementation",
                "pool state",
            ],
        },
    }

    output_dir = arguments.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    source_path = output_dir / "official-assets.source.json"
    snapshot_path = output_dir / "stock-token-reference.json"
    asset_csv_path = output_dir / "stock-tokens.csv"
    pool_csv_path = output_dir / "uniswap-pools.csv"
    source_path.write_bytes(source_raw)
    _write_json(snapshot_path, result)
    _write_asset_csv(asset_csv_path, assets, pools)
    _write_pool_csv(pool_csv_path, pools)
    manifest = {
        "schemaVersion": 1,
        "capturedAt": captured_at,
        "files": [
            {"path": path.name, "bytes": path.stat().st_size, "sha256": _sha256(path)}
            for path in (source_path, snapshot_path, asset_csv_path, pool_csv_path)
        ],
    }
    _write_json(output_dir / "manifest.json", manifest)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "snapshots" / dt.date.today().isoformat(),
    )
    parser.add_argument("--rpc-url", default=os.environ.get("RH_RPC_URL", DEFAULT_RPC))
    parser.add_argument("--block-tag", default="finalized")
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--request-interval", type=float, default=1.1)
    parser.add_argument("--log-chunk-blocks", type=int, default=5_000_000)
    parser.add_argument(
        "--asset-limit",
        type=int,
        help="Smoke-test only: restrict assets and mark the snapshot as limited",
    )
    arguments = parser.parse_args()
    if arguments.batch_size <= 0 or arguments.request_interval < 0:
        parser.error("batch size must be positive and interval non-negative")
    if arguments.log_chunk_blocks <= 0:
        parser.error("log chunk size must be positive")
    if arguments.asset_limit is not None and arguments.asset_limit <= 0:
        parser.error("asset limit must be positive")
    result = capture(arguments)
    print(
        json.dumps(
            {
                "outputDir": str(arguments.output_dir),
                "chain": result["chain"],
                "summary": result["summary"],
                "captureStats": result["captureStats"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
