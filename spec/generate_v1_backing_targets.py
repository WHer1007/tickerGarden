"""Retired V1-EXEC-1 backing-target research generator.

This file is retained only to audit the abandoned price-based design. It is not
an input to V1-EXEC-6 and must not be used for STOCK eligibility, market
creation, staking weight, fee distribution or readiness. See
RETIRED_STOCK_PRICE_RESEARCH.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

try:
    from spec.generate_v1_hash_vectors import keccak256
    from spec.v1_reference_model import (
        BACKING_TARGET_CONFIG_DOMAIN_LABEL,
        MAX_ACCOUNTING_AMOUNT,
        MAX_SUPPORTED_ASSET_DECIMALS,
        MIN_SUPPORTED_ASSET_DECIMALS,
        backing_target_config_hash,
        backing_target_stock_from_usd,
        minimum_nonzero_stock_position,
        partition_pool_fee_linear_legacy,
    )
except ModuleNotFoundError:  # direct execution from the spec directory
    from generate_v1_hash_vectors import keccak256
    from v1_reference_model import (
        BACKING_TARGET_CONFIG_DOMAIN_LABEL,
        MAX_ACCOUNTING_AMOUNT,
        MAX_SUPPORTED_ASSET_DECIMALS,
        MIN_SUPPORTED_ASSET_DECIMALS,
        backing_target_config_hash,
        backing_target_stock_from_usd,
        minimum_nonzero_stock_position,
        partition_pool_fee_linear_legacy,
    )


APPROVED_STATUS = "APPROVED_FOR_CONFIG_GENERATION"
POLICY_METHOD = "UNIFORM_USD_NOTIONAL_AT_FIXED_PRICE_SNAPSHOT"
ROUNDING = "CEIL_TO_ONE_STOCK_RAW_UNIT"
PRICE_SOURCE = "CHAINLINK_PER_TOKEN_FEED_PROXY"
FEED_DIRECTORY_URL = (
    "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json"
)
EXECUTION_SPEC_ID = "V1-EXEC-1"
EXECUTION_SPEC_HASH = "0x" + keccak256(EXECUTION_SPEC_ID.encode()).hex()
HEX_32 = re.compile(r"^0x[0-9a-fA-F]{64}$")
HEX_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
CANONICAL_POSITIVE_INTEGER = re.compile(r"^[1-9][0-9]*$")
CANONICAL_NONNEGATIVE_INTEGER = re.compile(r"^(0|[1-9][0-9]*)$")
DECIMALS_SELECTOR = "0x313ce567"
DESCRIPTION_SELECTOR = "0x7284e416"
LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c"
ORACLE_PAUSED_SELECTOR = "0x7706ba52"
IMPLEMENTATION_SELECTOR = "0x5c60da1b"
Rpc = Callable[[list[dict[str, Any]]], dict[int, Any]]


def _positive_int(value: Any, name: str) -> int:
    if type(value) is int:
        result = value
    elif isinstance(value, str) and CANONICAL_POSITIVE_INTEGER.fullmatch(value):
        result = int(value)
    else:
        raise ValueError(f"{name} must be a positive integer")
    if result <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return result


def _nonnegative_int(value: Any, name: str) -> int:
    if type(value) is int:
        result = value
    elif isinstance(value, str) and CANONICAL_NONNEGATIVE_INTEGER.fullmatch(value):
        result = int(value)
    else:
        raise ValueError(f"{name} must be a nonnegative integer")
    if result < 0:
        raise ValueError(f"{name} must be a nonnegative integer")
    return result


def _hex(value: Any, pattern: re.Pattern[str], name: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError(f"{name} has an invalid hex encoding")
    return value.lower()


def _nonzero_hex(value: Any, pattern: re.Pattern[str], name: str) -> str:
    normalized = _hex(value, pattern, name)
    if int(normalized, 16) == 0:
        raise ValueError(f"{name} must be nonzero")
    return normalized


def _runtime_hash(code: Any, name: str) -> str:
    if not isinstance(code, str) or code in {"0x", "0x0"}:
        raise ValueError(f"no bytecode for {name}")
    return "0x" + keccak256(bytes.fromhex(code.removeprefix("0x"))).hex()


def _abi_uint(value: Any, name: str) -> int:
    if not isinstance(value, str) or not HEX_32.fullmatch(value):
        raise ValueError(f"{name} did not return one ABI word")
    return int(value, 16)


def _rpc_quantity(value: Any, name: str) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0x(0|[1-9a-fA-F][0-9a-fA-F]*)", value):
        raise ValueError(f"{name} did not return a canonical RPC quantity")
    return int(value, 16)


def _abi_bool(value: Any, name: str) -> bool:
    result = _abi_uint(value, name)
    if result not in {0, 1}:
        raise ValueError(f"{name} returned a non-boolean ABI word")
    return result == 1


def _abi_address(value: Any, name: str) -> str:
    _abi_uint(value, name)
    result = "0x" + value[-40:].lower()
    if int(result, 16) == 0:
        raise ValueError(f"{name} returned the zero address")
    return result


def _abi_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise ValueError(f"{name} did not return ABI bytes")
    raw = bytes.fromhex(value[2:])
    if len(raw) < 64 or len(raw) % 32:
        raise ValueError(f"{name} returned malformed ABI string data")
    offset = int.from_bytes(raw[:32], "big")
    if offset + 32 > len(raw):
        raise ValueError(f"{name} returned an invalid ABI string offset")
    length = int.from_bytes(raw[offset : offset + 32], "big")
    start = offset + 32
    if start + length > len(raw):
        raise ValueError(f"{name} returned a truncated ABI string")
    try:
        return raw[start : start + length].decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(f"{name} returned a non-UTF-8 string") from error


def _latest_round_data(value: Any, name: str) -> dict[str, int]:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise ValueError(f"{name} did not return ABI bytes")
    raw = bytes.fromhex(value[2:])
    if len(raw) != 160:
        raise ValueError(f"{name} must return exactly five ABI words")
    words = [int.from_bytes(raw[index : index + 32], "big") for index in range(0, 160, 32)]
    answer = words[1]
    if answer >= 2**255:
        answer -= 2**256
    return {
        "roundId": words[0],
        "answer": answer,
        "startedAt": words[2],
        "updatedAt": words[3],
        "answeredInRound": words[4],
    }


def _http_request(url: str, payload: Any) -> bytes:
    body = json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "TickerGarden-V1-Backing-Target-Preflight/1.0",
        },
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            time.sleep(min(2**attempt, 8))
    raise AssertionError("unreachable")


def rpc_client(url: str) -> Rpc:
    def call(calls: list[dict[str, Any]]) -> dict[int, Any]:
        results: dict[int, Any] = {}
        batch_size = 40
        for offset in range(0, len(calls), batch_size):
            raw = _http_request(url, calls[offset : offset + batch_size])
            response = json.loads(raw)
            if not isinstance(response, list):
                response = [response]
            for item in response:
                if "error" in item:
                    raise ValueError(
                        f"RPC error for id {item.get('id')}: {item['error']}"
                    )
                results[int(item["id"])] = item["result"]
            if offset + batch_size < len(calls):
                time.sleep(0.75)
        missing = {int(entry["id"]) for entry in calls} - set(results)
        if missing:
            raise ValueError(f"RPC response omitted ids: {sorted(missing)}")
        return results

    return call


def _feed_directory(
    raw: bytes, snapshot: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    if snapshot.get("sourceUrl") != FEED_DIRECTORY_URL:
        raise ValueError("Chainlink feed directory source URL mismatch")
    if _positive_int(snapshot.get("chainId"), "feedDirectorySnapshot.chainId") != 4663:
        raise ValueError("Chainlink feed directory chainId mismatch")
    expected_hash = _nonzero_hex(
        snapshot.get("responseSha256"),
        HEX_32,
        "feedDirectorySnapshot.responseSha256",
    )
    actual_hash = "0x" + hashlib.sha256(raw).hexdigest()
    if actual_hash != expected_hash:
        raise ValueError("Chainlink feed directory archive hash mismatch")
    captured_at = snapshot.get("capturedAt")
    if not isinstance(captured_at, str) or not captured_at.strip():
        raise ValueError("feedDirectorySnapshot.capturedAt is required")

    payload = json.loads(raw)
    if not isinstance(payload, list) or not payload:
        raise ValueError("Chainlink feed directory must be a nonempty array")
    feeds: dict[str, dict[str, Any]] = {}
    for entry in payload:
        if not isinstance(entry, dict):
            raise ValueError("Chainlink feed directory contains a non-object entry")
        proxy = _nonzero_hex(
            entry.get("proxyAddress"), HEX_ADDRESS, "feed directory proxyAddress"
        )
        if proxy in feeds:
            raise ValueError(f"duplicate Chainlink feed proxy: {proxy}")
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"Chainlink feed {proxy} has no name")
        decimals = _nonnegative_int(
            entry.get("decimals"), f"feed directory decimals for {proxy}"
        )
        if decimals > 36:
            raise ValueError(f"unsupported feed decimals for {proxy}")
        heartbeat = _positive_int(
            entry.get("heartbeat"), f"feed directory heartbeat for {proxy}"
        )
        feeds[proxy] = {
            "name": name,
            "decimals": decimals,
            "heartbeatSeconds": heartbeat,
            "entrySha256": "0x"
            + hashlib.sha256(
                json.dumps(entry, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
        }
    return feeds


def _validate_catalog_archive(
    catalog_assets: list[dict[str, Any]], raw: bytes, chain_id: int
) -> None:
    payload = json.loads(raw)
    source_assets = payload.get("assets") if isinstance(payload, dict) else None
    if not isinstance(source_assets, list) or not source_assets:
        raise ValueError("official catalog source archive has no assets")
    archived: dict[str, dict[str, Any]] = {}
    for source in source_assets:
        if not isinstance(source, dict):
            raise ValueError("official catalog source contains a non-object asset")
        uid = _nonzero_hex(source.get("id"), HEX_32, "archived official assetUid")
        if uid in archived:
            raise ValueError(f"duplicate archived official assetUid: {uid}")
        deployments = [
            entry
            for entry in source.get("deployments", [])
            if isinstance(entry, dict) and entry.get("chainId") == chain_id
        ]
        if len(deployments) != 1:
            raise ValueError(f"archived official asset {uid} has no unique chain deployment")
        archived[uid] = {
            "stockToken": _nonzero_hex(
                deployments[0].get("contractAddress"),
                HEX_ADDRESS,
                f"archived stockToken for {uid}",
            ),
            "stockDecimals": source.get("tokenDecimals"),
            "symbol": source.get("tokenSymbol"),
            "name": source.get("tokenName"),
            "isin": source.get("isin"),
            "officialStatus": source.get("status"),
        }
    catalog_by_uid = {asset["assetUid"].lower(): asset for asset in catalog_assets}
    if set(archived) != set(catalog_by_uid):
        raise ValueError("official catalog assets do not exactly match the source archive")
    for uid, identity in archived.items():
        asset = catalog_by_uid[uid]
        for key, value in identity.items():
            candidate = asset.get(key)
            if key == "stockToken" and isinstance(candidate, str):
                candidate = candidate.lower()
            if candidate != value:
                raise ValueError(
                    f"official catalog {key} differs from source archive for {uid}"
                )


def _feed_name_matches_symbol(name: str, symbol: Any) -> bool:
    if not isinstance(symbol, str) or not symbol:
        return False
    if not name.startswith("Robinhood "):
        return False
    pair = re.sub(r"\s+", "", name.removeprefix("Robinhood ")).replace("/", "-")
    return pair.upper() == f"{symbol.upper()}-USD"


def _capture_live_evidence(
    chain_id: int,
    snapshot: dict[str, Any],
    selected_uids: list[str],
    catalog_assets: dict[str, dict[str, Any]],
    prices: dict[str, dict[str, Any]],
    directory: dict[str, dict[str, Any]],
    sequencer_source_raw: bytes,
    rpc: Rpc,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    if snapshot.get("finality") != "FINALIZED":
        raise ValueError("priceSnapshot.finality must be FINALIZED")
    block_number = _positive_int(snapshot.get("block"), "priceSnapshot.block")
    block_hash = _nonzero_hex(
        snapshot.get("blockHash"), HEX_32, "priceSnapshot.blockHash"
    )
    block_timestamp = _positive_int(
        snapshot.get("timestamp"), "priceSnapshot.timestamp"
    )
    block_tag = hex(block_number)

    sequencer = snapshot.get("sequencer")
    if not isinstance(sequencer, dict):
        raise ValueError("canonical onchain sequencer evidence is required")
    sequencer_source = sequencer.get("canonicalSourceUrl")
    if not isinstance(sequencer_source, str) or not sequencer_source.startswith("https://"):
        raise ValueError("canonical sequencer source URL is required")
    if urllib.parse.urlparse(sequencer_source).hostname not in {
        "docs.robinhood.com",
        "docs.chain.link",
    }:
        raise ValueError("sequencer source must be an official Robinhood or Chainlink URL")
    sequencer_source_hash = _nonzero_hex(
        sequencer.get("canonicalSourceContentSha256"),
        HEX_32,
        "sequencer canonical source hash",
    )
    if "0x" + hashlib.sha256(sequencer_source_raw).hexdigest() != sequencer_source_hash:
        raise ValueError("canonical sequencer source archive hash mismatch")
    sequencer_proxy = _nonzero_hex(
        sequencer.get("feedProxy"), HEX_ADDRESS, "sequencer feedProxy"
    )
    sequencer_runtime_hash = _nonzero_hex(
        sequencer.get("feedRuntimeKeccak256"),
        HEX_32,
        "sequencer feedRuntimeKeccak256",
    )
    grace_period = _positive_int(
        sequencer.get("gracePeriodSeconds"), "sequencer gracePeriodSeconds"
    )

    calls: list[dict[str, Any]] = []
    next_id = 1

    def add(method: str, params: list[Any]) -> int:
        nonlocal next_id
        call_id = next_id
        next_id += 1
        calls.append(
            {"jsonrpc": "2.0", "id": call_id, "method": method, "params": params}
        )
        return call_id

    chain_id_call = add("eth_chainId", [])
    block_call = add("eth_getBlockByNumber", [block_tag, False])
    sequencer_code_call = add("eth_getCode", [sequencer_proxy, block_tag])
    sequencer_decimals_call = add(
        "eth_call", [{"to": sequencer_proxy, "data": DECIMALS_SELECTOR}, block_tag]
    )
    sequencer_round_call = add(
        "eth_call",
        [{"to": sequencer_proxy, "data": LATEST_ROUND_DATA_SELECTOR}, block_tag],
    )

    call_ids: dict[str, dict[str, int]] = {}
    for uid in selected_uids:
        asset = catalog_assets[uid]
        row = prices[uid]
        feed_proxy = _nonzero_hex(
            row.get("feedProxy"), HEX_ADDRESS, f"feedProxy for {uid}"
        )
        if feed_proxy not in directory:
            raise ValueError(f"feedProxy for {uid} is not a primary canonical directory feed")
        feed = directory[feed_proxy]
        if not _feed_name_matches_symbol(feed["name"], asset.get("symbol")):
            raise ValueError(f"canonical feed name does not match official asset {uid}")
        if row.get("feedDirectoryEntrySha256") != feed["entrySha256"]:
            raise ValueError(f"feed directory entry hash mismatch for {uid}")

        ids = {
            "stockCode": add("eth_getCode", [asset["stockToken"], block_tag]),
            "oraclePaused": add(
                "eth_call",
                [{"to": asset["stockToken"], "data": ORACLE_PAUSED_SELECTOR}, block_tag],
            ),
            "feedCode": add("eth_getCode", [feed_proxy, block_tag]),
            "feedDecimals": add(
                "eth_call",
                [{"to": feed_proxy, "data": DECIMALS_SELECTOR}, block_tag],
            ),
            "feedDescription": add(
                "eth_call",
                [{"to": feed_proxy, "data": DESCRIPTION_SELECTOR}, block_tag],
            ),
            "feedRound": add(
                "eth_call",
                [{"to": feed_proxy, "data": LATEST_ROUND_DATA_SELECTOR}, block_tag],
            ),
        }
        upgradeability = asset.get("upgradeability")
        if not isinstance(upgradeability, dict):
            raise ValueError(f"upgradeability evidence missing for {uid}")
        kind = upgradeability.get("kind")
        if kind == "IMMUTABLE_BEACON_PROXY":
            beacon = _nonzero_hex(
                upgradeability.get("beacon"), HEX_ADDRESS, f"beacon for {uid}"
            )
            implementation = _nonzero_hex(
                upgradeability.get("implementation"),
                HEX_ADDRESS,
                f"implementation for {uid}",
            )
            ids.update(
                {
                    "beaconCode": add("eth_getCode", [beacon, block_tag]),
                    "beaconImplementation": add(
                        "eth_call",
                        [{"to": beacon, "data": IMPLEMENTATION_SELECTOR}, block_tag],
                    ),
                    "implementationCode": add(
                        "eth_getCode", [implementation, block_tag]
                    ),
                }
            )
        elif kind != "DIRECT_RUNTIME":
            raise ValueError(f"unsupported upgradeability kind for {uid}")
        call_ids[uid] = ids

    results = rpc(calls)
    if _rpc_quantity(results[chain_id_call], "eth_chainId") != chain_id:
        raise ValueError("RPC chainId mismatch")
    block = results[block_call]
    if not isinstance(block, dict):
        raise ValueError("RPC returned no fixed price snapshot block")
    if _rpc_quantity(block.get("number"), "block.number") != block_number:
        raise ValueError("RPC price snapshot block number mismatch")
    if block.get("hash", "").lower() != block_hash:
        raise ValueError("RPC price snapshot block hash mismatch")
    if _rpc_quantity(block.get("timestamp"), "block.timestamp") != block_timestamp:
        raise ValueError("RPC price snapshot timestamp mismatch")

    if _runtime_hash(results[sequencer_code_call], "sequencer feed") != sequencer_runtime_hash:
        raise ValueError("sequencer feed runtime codehash mismatch")
    if _abi_uint(results[sequencer_decimals_call], "sequencer decimals()") != 0:
        raise ValueError("sequencer uptime feed decimals must be zero")
    sequencer_round = _latest_round_data(
        results[sequencer_round_call], "sequencer latestRoundData()"
    )
    if sequencer_round["answer"] != 0:
        raise ValueError("sequencer must be up at the price snapshot")
    if sequencer_round["answeredInRound"] < sequencer_round["roundId"]:
        raise ValueError("sequencer round is incomplete")
    if sequencer_round["startedAt"] <= 0:
        raise ValueError("sequencer startedAt is invalid")
    elapsed = block_timestamp - sequencer_round["startedAt"]
    if elapsed <= grace_period:
        raise ValueError("sequencer recovery grace period has not passed")

    live_prices: dict[str, dict[str, Any]] = {}
    seen_feed_proxies: set[str] = set()
    for uid in selected_uids:
        asset = catalog_assets[uid]
        row = prices[uid]
        feed_proxy = row["feedProxy"].lower()
        if feed_proxy in seen_feed_proxies:
            raise ValueError("one canonical feed proxy cannot price two selected assets")
        seen_feed_proxies.add(feed_proxy)
        feed = directory[feed_proxy]
        ids = call_ids[uid]
        if _runtime_hash(results[ids["stockCode"]], f"Stock token {uid}") != asset[
            "runtimeKeccak256"
        ]:
            raise ValueError(f"Stock token runtime codehash drift for {uid}")
        if _abi_bool(results[ids["oraclePaused"]], f"oraclePaused() for {uid}"):
            raise ValueError(f"oracle is paused for {uid}")
        feed_runtime_hash = _runtime_hash(
            results[ids["feedCode"]], f"price feed {uid}"
        )
        feed_decimals = _abi_uint(
            results[ids["feedDecimals"]], f"feed decimals() for {uid}"
        )
        if feed_decimals != feed["decimals"]:
            raise ValueError(f"feed decimals differ from canonical directory for {uid}")
        description = _abi_string(
            results[ids["feedDescription"]], f"feed description() for {uid}"
        )
        round_data = _latest_round_data(
            results[ids["feedRound"]], f"feed latestRoundData() for {uid}"
        )
        if round_data["answer"] <= 0:
            raise ValueError(f"nonpositive Chainlink answer for {uid}")
        if round_data["answeredInRound"] < round_data["roundId"]:
            raise ValueError(f"incomplete Chainlink round for {uid}")
        age = block_timestamp - round_data["updatedAt"]
        if age < 0 or age > feed["heartbeatSeconds"]:
            raise ValueError(f"stale or future Chainlink answer for {uid}")

        upgradeability = asset["upgradeability"]
        if upgradeability["kind"] == "IMMUTABLE_BEACON_PROXY":
            if _runtime_hash(results[ids["beaconCode"]], f"beacon for {uid}") != _nonzero_hex(
                upgradeability.get("beaconRuntimeKeccak256"),
                HEX_32,
                f"beaconRuntimeKeccak256 for {uid}",
            ):
                raise ValueError(f"beacon runtime codehash drift for {uid}")
            if _abi_address(
                results[ids["beaconImplementation"]],
                f"beacon implementation() for {uid}",
            ) != upgradeability["implementation"].lower():
                raise ValueError(f"beacon implementation address drift for {uid}")
            if _runtime_hash(
                results[ids["implementationCode"]], f"implementation for {uid}"
            ) != _nonzero_hex(
                upgradeability.get("implementationRuntimeKeccak256"),
                HEX_32,
                f"implementationRuntimeKeccak256 for {uid}",
            ):
                raise ValueError(f"implementation runtime codehash drift for {uid}")

        live_prices[uid] = {
            "feedProxy": feed_proxy,
            "feedRuntimeKeccak256": feed_runtime_hash,
            "feedDirectoryEntrySha256": feed["entrySha256"],
            "feedDirectoryName": feed["name"],
            "feedDescription": description,
            "feedDecimals": feed_decimals,
            "roundId": round_data["roundId"],
            "answeredInRound": round_data["answeredInRound"],
            "answer": round_data["answer"],
            "startedAt": round_data["startedAt"],
            "updatedAt": round_data["updatedAt"],
            "ageSecondsAtSnapshot": age,
            "heartbeatSeconds": feed["heartbeatSeconds"],
            "oraclePaused": False,
        }

    return (
        {
            "block": block_number,
            "blockHash": block_hash,
            "timestamp": block_timestamp,
            "finality": "FINALIZED",
            "sequencer": {
                "canonicalSourceUrl": sequencer_source,
                "canonicalSourceContentSha256": sequencer_source_hash,
                "feedProxy": sequencer_proxy,
                "feedRuntimeKeccak256": sequencer_runtime_hash,
                "roundId": str(sequencer_round["roundId"]),
                "answeredInRound": str(sequencer_round["answeredInRound"]),
                "answer": sequencer_round["answer"],
                "startedAt": sequencer_round["startedAt"],
                "updatedAt": sequencer_round["updatedAt"],
                "gracePeriodSeconds": grace_period,
                "elapsedSinceStatusChange": elapsed,
                "status": "UP",
            },
        },
        live_prices,
    )


def _vector_case(
    label: str, base: int, active: int, target: int, minimum_position: int
) -> dict[str, Any]:
    result = partition_pool_fee_linear_legacy(base, active, target)
    return {
        "label": label,
        "activeStock": str(active),
        "reachableByValidPositions": active == 0 or active >= minimum_position,
        "effectiveBackingStock": str(min(active, target)),
        "outputs": {
            "totalFee": str(result.total),
            "lp": str(result.lp),
            "nonLp": str(result.non_lp),
            "creator": str(result.creator),
            "staker": str(result.staker),
            "platform": str(result.platform),
        },
    }


def _target_vectors(base: int, stock_decimals: int, target: int) -> list[dict[str, Any]]:
    minimum = minimum_nonzero_stock_position(stock_decimals)
    requested = [
        ("S_ZERO", 0),
        ("S_MINIMUM_VALID_POSITION", minimum),
        ("S_HALF_TARGET_FLOOR", target // 2),
        ("S_TARGET_MINUS_ONE", target - 1),
        ("S_AT_TARGET", target),
    ]
    if target < MAX_ACCOUNTING_AMOUNT:
        requested.append(("S_TARGET_PLUS_ONE", target + 1))
    if target <= MAX_ACCOUNTING_AMOUNT // 2:
        requested.append(("S_DOUBLE_TARGET", target * 2))
    elif target < MAX_ACCOUNTING_AMOUNT:
        requested.append(("S_MAX_ACCOUNTING_AMOUNT", MAX_ACCOUNTING_AMOUNT))

    seen: set[int] = set()
    vectors: list[dict[str, Any]] = []
    for label, active in requested:
        if active in seen:
            continue
        seen.add(active)
        vectors.append(_vector_case(label, base, active, target, minimum))
    return vectors


def build(
    catalog: dict[str, Any],
    approved_input: dict[str, Any],
    *,
    catalog_source_raw: bytes | None = None,
    feed_directory_raw: bytes | None = None,
    sequencer_source_raw: bytes | None = None,
    rpc: Rpc | None = None,
) -> dict[str, Any]:
    if approved_input.get("status") != APPROVED_STATUS:
        raise ValueError(f"input status must be {APPROVED_STATUS}")
    if approved_input.get("executionSpecId") != EXECUTION_SPEC_ID:
        raise ValueError("executionSpecId mismatch")
    chain_id = _positive_int(approved_input.get("chainId"), "chainId")
    catalog_chain_id = _positive_int(catalog.get("chainId"), "catalog chainId")
    if chain_id != catalog_chain_id:
        raise ValueError("catalog and input chainId mismatch")
    if catalog.get("executionSpecId") != EXECUTION_SPEC_ID:
        raise ValueError("official catalog executionSpecId mismatch")
    if (
        catalog.get("status")
        != "ELIGIBILITY_POLICY_APPROVED_IDENTITY_SNAPSHOT_FINALIZED_TARGETS_PENDING"
    ):
        raise ValueError("official catalog must be a finalized production snapshot")
    if (
        catalog.get("source", {}).get("url")
        != "https://api.robinhood.com/rhj/assets"
    ):
        raise ValueError("official catalog source URL mismatch")
    if catalog.get("summary", {}).get("allIdentityChecksPassed") is not True:
        raise ValueError("official catalog identity checks are incomplete")
    if (
        catalog.get("summary", {}).get("allImplementationFingerprintsPassed")
        is not True
    ):
        raise ValueError("official catalog implementation checks are incomplete")
    if catalog.get("source", {}).get("rawResponseArchived") is not True:
        raise ValueError("official catalog raw source response is not archived")
    if catalog_source_raw is None:
        raise ValueError("the exact official catalog source archive is required")
    catalog_source_hash = "0x" + hashlib.sha256(catalog_source_raw).hexdigest()
    if catalog_source_hash != catalog.get("source", {}).get("responseSha256"):
        raise ValueError("official catalog source archive hash mismatch")
    if len(catalog_source_raw) != catalog.get("source", {}).get("responseBytes"):
        raise ValueError("official catalog source archive byte length mismatch")
    catalog_snapshot = catalog.get("chainSnapshot")
    if not isinstance(catalog_snapshot, dict):
        raise ValueError("official catalog chain snapshot is missing")
    _positive_int(catalog_snapshot.get("block"), "catalog chainSnapshot.block")
    if catalog_snapshot.get("finality") != "FINALIZED":
        raise ValueError("official catalog chain snapshot must be finalized")
    _nonzero_hex(
        catalog_snapshot.get("blockHash"), HEX_32, "catalog chainSnapshot.blockHash"
    )
    _nonzero_hex(
        catalog.get("source", {}).get("responseSha256"),
        HEX_32,
        "catalog source responseSha256",
    )

    catalog_hash = _hex(
        catalog.get("summary", {}).get("normalizedCatalogKeccak256"),
        HEX_32,
        "catalog hash",
    )
    catalog_assets_raw = catalog.get("assets")
    if not isinstance(catalog_assets_raw, list) or not catalog_assets_raw:
        raise ValueError("official catalog assets must be a nonempty array")
    _validate_catalog_archive(catalog_assets_raw, catalog_source_raw, chain_id)
    seen_catalog_uids: set[str] = set()
    seen_catalog_tokens: set[str] = set()
    for asset in catalog_assets_raw:
        uid = _nonzero_hex(asset.get("assetUid"), HEX_32, "catalog assetUid")
        token = _nonzero_hex(
            asset.get("stockToken"), HEX_ADDRESS, f"stockToken for {uid}"
        )
        if uid in seen_catalog_uids or token in seen_catalog_tokens:
            raise ValueError("official catalog contains duplicate identity")
        seen_catalog_uids.add(uid)
        seen_catalog_tokens.add(token)
        decimals = asset.get("stockDecimals")
        if type(decimals) is not int or not (
            MIN_SUPPORTED_ASSET_DECIMALS
            <= decimals
            <= MAX_SUPPORTED_ASSET_DECIMALS
        ):
            raise ValueError(f"unsupported official Stock decimals for {uid}")
        _nonzero_hex(
            asset.get("runtimeKeccak256"), HEX_32, f"runtimeKeccak256 for {uid}"
        )
        if asset.get("eligibleByOfficialIdentity") is not True:
            raise ValueError(f"official identity is not verified for {uid}")
        if asset.get("onchainUidVerified") is not True:
            raise ValueError(f"onchain uid is not verified for {uid}")
        if asset.get("onchainDecimalsVerified") is not True:
            raise ValueError(f"onchain decimals are not verified for {uid}")
        if asset.get("implementationFingerprintVerified") is not True:
            raise ValueError(f"implementation fingerprint is not verified for {uid}")
        upgradeability = asset.get("upgradeability")
        if not isinstance(upgradeability, dict):
            raise ValueError(f"upgradeability evidence is missing for {uid}")
        kind = upgradeability.get("kind")
        _nonzero_hex(
            upgradeability.get("implementation"),
            HEX_ADDRESS,
            f"implementation for {uid}",
        )
        _nonzero_hex(
            upgradeability.get("implementationRuntimeKeccak256"),
            HEX_32,
            f"implementationRuntimeKeccak256 for {uid}",
        )
        if kind == "IMMUTABLE_BEACON_PROXY":
            _nonzero_hex(
                upgradeability.get("beacon"), HEX_ADDRESS, f"beacon for {uid}"
            )
            _nonzero_hex(
                upgradeability.get("beaconRuntimeKeccak256"),
                HEX_32,
                f"beaconRuntimeKeccak256 for {uid}",
            )
        elif kind != "DIRECT_RUNTIME":
            raise ValueError(f"unsupported upgradeability kind for {uid}")
    recomputed_catalog_hash = "0x" + keccak256(
        json.dumps(
            catalog_assets_raw, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hex()
    if recomputed_catalog_hash != catalog_hash:
        raise ValueError("official catalog normalized hash mismatch")
    summary = catalog["summary"]
    if summary.get("assetCount") != len(catalog_assets_raw):
        raise ValueError("official catalog asset count mismatch")
    if summary.get("uniqueAssetUidCount") != len(seen_catalog_uids):
        raise ValueError("official catalog UID count mismatch")
    if summary.get("uniqueTokenCount") != len(seen_catalog_tokens):
        raise ValueError("official catalog token count mismatch")
    if _hex(approved_input.get("officialCatalogHash"), HEX_32, "officialCatalogHash") != catalog_hash:
        raise ValueError("approved input does not bind the selected official catalog")

    policy = approved_input.get("targetPolicy")
    if not isinstance(policy, dict):
        raise ValueError("targetPolicy is required")
    if policy.get("method") != POLICY_METHOD:
        raise ValueError("unsupported target policy method")
    if policy.get("rounding") != ROUNDING:
        raise ValueError("backing target rounding must be frozen to one raw unit ceiling")
    if policy.get("priceSource") != PRICE_SOURCE:
        raise ValueError("price source must be the per-token Chainlink feed proxy")
    if policy.get("runtimeOracleDependency") is not False:
        raise ValueError("backing targets must not depend on a runtime oracle")
    target_usd18 = _positive_int(policy.get("targetUsd18"), "targetUsd18")

    snapshot = approved_input.get("priceSnapshot")
    if not isinstance(snapshot, dict):
        raise ValueError("priceSnapshot is required")

    catalog_assets = {
        asset["assetUid"].lower(): asset
        for asset in catalog_assets_raw
    }
    if not catalog_assets:
        raise ValueError("official catalog has no assets")

    selected_rows = approved_input.get("selectedAssetUids")
    if not isinstance(selected_rows, list) or not selected_rows:
        raise ValueError("selectedAssetUids must be a nonempty explicit array")
    selected_uids = [
        _hex(value, HEX_32, "selected assetUid") for value in selected_rows
    ]
    if len(selected_uids) != len(set(selected_uids)):
        raise ValueError("selectedAssetUids contains a duplicate")
    unknown = sorted(set(selected_uids) - set(catalog_assets))
    if unknown:
        raise ValueError(f"selected assets are not in the official catalog: {unknown[:3]}")
    for uid in selected_uids:
        asset = catalog_assets[uid]
        if asset.get("enabledForNewMarketsCandidate") is not True:
            raise ValueError(f"selected official asset is not operationally active: {uid}")

    price_rows = approved_input.get("prices")
    if not isinstance(price_rows, list) or not price_rows:
        raise ValueError("prices must be a nonempty array")
    prices: dict[str, dict[str, Any]] = {}
    for row in price_rows:
        uid = _hex(row.get("assetUid"), HEX_32, "price assetUid")
        if uid in prices:
            raise ValueError(f"duplicate price evidence for {uid}")
        prices[uid] = row
    if set(prices) != set(selected_uids):
        missing = sorted(set(selected_uids) - set(prices))
        extra = sorted(set(prices) - set(selected_uids))
        raise ValueError(
            f"price evidence must exactly cover selected official assets; missing={missing[:3]}, extra={extra[:3]}"
        )
    if feed_directory_raw is None:
        raise ValueError("the exact Chainlink feed directory archive is required")
    feed_directory_snapshot = approved_input.get("feedDirectorySnapshot")
    if not isinstance(feed_directory_snapshot, dict):
        raise ValueError("feedDirectorySnapshot is required")
    directory = _feed_directory(feed_directory_raw, feed_directory_snapshot)
    if rpc is None:
        raise ValueError("a fixed-block RPC verifier is required")
    if sequencer_source_raw is None:
        raise ValueError("the canonical sequencer source archive is required")
    verified_snapshot, live_prices = _capture_live_evidence(
        chain_id,
        snapshot,
        sorted(selected_uids),
        catalog_assets,
        prices,
        directory,
        sequencer_source_raw,
        rpc,
    )

    vector_fee_base = _positive_int(
        approved_input.get("vectorFeeBase"), "vectorFeeBase"
    )
    configs: list[dict[str, Any]] = []
    seen_config_ids: set[str] = set()
    for uid in sorted(selected_uids):
        asset = catalog_assets[uid]
        row = live_prices[uid]
        feed_decimals = row["feedDecimals"]
        answer = row["answer"]

        stock_decimals = int(asset["stockDecimals"])
        target = backing_target_stock_from_usd(
            target_usd18,
            stock_decimals,
            answer,
            feed_decimals,
        )
        config_id = backing_target_config_hash(
            chain_id,
            EXECUTION_SPEC_HASH,
            uid,
            asset["stockToken"],
            stock_decimals,
            target,
        )
        if config_id in seen_config_ids:
            raise ValueError("backing target config ID collision")
        seen_config_ids.add(config_id)
        configs.append(
            {
                "assetUid": uid,
                "symbol": asset.get("symbol"),
                "stockToken": asset["stockToken"].lower(),
                "stockDecimals": stock_decimals,
                "backingTargetConfigId": config_id,
                "backingTargetStock": str(target),
                "minimumNonzeroPosition": str(
                    minimum_nonzero_stock_position(stock_decimals)
                ),
                "enabledForNewMarkets": True,
                "priceEvidence": {
                    "feedProxy": row["feedProxy"],
                    "feedRuntimeKeccak256": row["feedRuntimeKeccak256"],
                    "feedDirectoryEntrySha256": row[
                        "feedDirectoryEntrySha256"
                    ],
                    "feedDirectoryName": row["feedDirectoryName"],
                    "feedDescription": row["feedDescription"],
                    "feedDecimals": feed_decimals,
                    "roundId": str(row["roundId"]),
                    "answeredInRound": str(row["answeredInRound"]),
                    "answer": str(answer),
                    "startedAt": row["startedAt"],
                    "updatedAt": row["updatedAt"],
                    "ageSecondsAtSnapshot": row["ageSecondsAtSnapshot"],
                    "heartbeatSeconds": row["heartbeatSeconds"],
                    "oraclePaused": False,
                },
                "vectors": _target_vectors(vector_fee_base, stock_decimals, target),
            }
        )

    return {
        "schemaVersion": 1,
        "executionSpecId": EXECUTION_SPEC_ID,
        "executionSpecHash": EXECUTION_SPEC_HASH,
        "status": "APPROVED_BACKING_TARGET_CONFIGS",
        "chainId": chain_id,
        "officialCatalogHash": catalog_hash,
        "selectionScope": "EXPLICIT_OFFICIAL_ASSET_UIDS",
        "selectedAssetUids": sorted(selected_uids),
        "configurationCount": len(configs),
        "targetPolicy": {
            "method": POLICY_METHOD,
            "targetUsd18": str(target_usd18),
            "rounding": ROUNDING,
            "priceSource": PRICE_SOURCE,
            "priceIncludesRobinhoodUiMultiplier": True,
            "applyUiMultiplierAgain": False,
            "runtimeOracleDependency": False,
            "marketSnapshotImmutable": True,
            "creatorOverride": False,
        },
        "feedDirectorySnapshot": {
            "sourceUrl": FEED_DIRECTORY_URL,
            "chainId": chain_id,
            "capturedAt": feed_directory_snapshot["capturedAt"],
            "responseSha256": feed_directory_snapshot["responseSha256"].lower(),
        },
        "priceSnapshot": verified_snapshot,
        "backingTargetConfigHash": {
            "domainLabel": BACKING_TARGET_CONFIG_DOMAIN_LABEL,
            "domain": "0x" + keccak256(BACKING_TARGET_CONFIG_DOMAIN_LABEL.encode()).hex(),
            "schemaVersion": 1,
            "encoding": "keccak256(abi.encode(domain,schemaVersion,chainId,executionSpecId,assetUid,stockToken,stockDecimals,backingTargetStock))",
            "configIdRule": "backingTargetConfigId == contentHash",
        },
        "vectorFeeBase": str(vector_fee_base),
        "configs": configs,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--catalog-source", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--feed-directory", type=Path, required=True)
    parser.add_argument("--sequencer-source", type=Path, required=True)
    parser.add_argument("--rpc-url", required=True)
    parser.add_argument("--write", type=Path)
    arguments = parser.parse_args()
    catalog_document = json.loads(arguments.catalog.read_text(encoding="utf-8"))
    catalog_source_raw = arguments.catalog_source.read_bytes()
    input_document = json.loads(arguments.input.read_text(encoding="utf-8"))
    feed_directory_raw = arguments.feed_directory.read_bytes()
    sequencer_source_raw = arguments.sequencer_source.read_bytes()
    rendered = json.dumps(
        build(
            catalog_document,
            input_document,
            catalog_source_raw=catalog_source_raw,
            feed_directory_raw=feed_directory_raw,
            sequencer_source_raw=sequencer_source_raw,
            rpc=rpc_client(arguments.rpc_url),
        ),
        indent=2,
        ensure_ascii=False,
    ) + "\n"
    if arguments.write:
        arguments.write.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
