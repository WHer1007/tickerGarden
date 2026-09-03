"""Capture and verify the official Robinhood Chain Stock Token directory.

The output is identity evidence for TickerGarden governance, not an onchain
HTTP or price dependency. Every ACTIVE official token is an equal candidate
for a market's single immutable staking base. Each token is checked at one
fixed Robinhood Chain block for bytecode, ``uid()`` and ``decimals()`` before
the normalized catalog is emitted.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

try:
    from spec.generate_v2_hash_vectors import keccak256
    from spec.v2_reference_model import (
        MAX_SUPPORTED_ASSET_DECIMALS,
        MIN_SUPPORTED_ASSET_DECIMALS,
    )
except ModuleNotFoundError:  # direct execution from the spec directory
    from generate_v2_hash_vectors import keccak256
    from v2_reference_model import (
        MAX_SUPPORTED_ASSET_DECIMALS,
        MIN_SUPPORTED_ASSET_DECIMALS,
    )


CHAIN_ID = 4663
EXECUTION_SPEC_ID = "V2-EXEC-3"
ASSET_API = "https://api.robinhood.com/rhj/assets"
PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com"
USER_AGENT = "TickerGarden-V2-Stock-Identity-Preflight/1.0"
DECIMALS_SELECTOR = "0x313ce567"
UID_SELECTOR = "0xf514ce36"
IMPLEMENTATION_SELECTOR = "0x5c60da1b"
HEX_32 = re.compile(r"^0x[0-9a-fA-F]{64}$")
HEX_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
IMMUTABLE_BEACON_SUFFIX = bytes.fromhex("6001600160a01b0316635c60da1b")


def _request(url: str, payload: Any | None = None) -> bytes:
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    headers = {"User-Agent": USER_AGENT}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else 2**attempt
            time.sleep(min(delay, 8))
    raise AssertionError("unreachable")


def _rpc(calls: list[dict[str, Any]]) -> dict[int, Any]:
    results: dict[int, Any] = {}
    batch_size = 40
    for offset in range(0, len(calls), batch_size):
        raw = _request(PUBLIC_RPC, calls[offset : offset + batch_size])
        response = json.loads(raw)
        if not isinstance(response, list):
            response = [response]
        for item in response:
            if "error" in item:
                raise ValueError(f"RPC error for id {item.get('id')}: {item['error']}")
            results[int(item["id"])] = item["result"]
        if offset + batch_size < len(calls):
            time.sleep(0.75)
    missing = {int(call["id"]) for call in calls} - set(results)
    if missing:
        raise ValueError(f"RPC response omitted ids: {sorted(missing)}")
    return results


def _base_assets(payload: dict[str, Any]) -> list[dict[str, Any]]:
    source_assets = payload.get("assets")
    if not isinstance(source_assets, list) or not source_assets:
        raise ValueError("official asset response must contain a nonempty assets array")

    normalized: list[dict[str, Any]] = []
    seen_uids: set[str] = set()
    seen_tokens: set[str] = set()
    for source in source_assets:
        uid = source.get("id")
        if not isinstance(uid, str) or not HEX_32.fullmatch(uid):
            raise ValueError("official asset has an invalid UID")
        uid = uid.lower()
        if uid in seen_uids:
            raise ValueError(f"duplicate official asset UID: {uid}")
        seen_uids.add(uid)

        deployments = [
            entry
            for entry in source.get("deployments", [])
            if entry.get("chainId") == CHAIN_ID
        ]
        if len(deployments) != 1:
            raise ValueError(f"{uid} must have exactly one chain {CHAIN_ID} deployment")
        token = deployments[0].get("contractAddress")
        if not isinstance(token, str) or not HEX_ADDRESS.fullmatch(token):
            raise ValueError(f"{uid} has an invalid canonical token address")
        token = token.lower()
        if token in seen_tokens:
            raise ValueError(f"duplicate canonical Stock Token address: {token}")
        seen_tokens.add(token)

        decimals = source.get("tokenDecimals")
        if not isinstance(decimals, int) or not (
            MIN_SUPPORTED_ASSET_DECIMALS
            <= decimals
            <= MAX_SUPPORTED_ASSET_DECIMALS
        ):
            raise ValueError(f"{uid} has unsupported token decimals: {decimals}")
        status = source.get("status")
        if status not in {
            "ASSET_STATUS_UNSPECIFIED",
            "ASSET_STATUS_ACTIVE",
            "ASSET_STATUS_INACTIVE",
        }:
            raise ValueError(f"{uid} has unsupported official status: {status}")

        normalized.append(
            {
                "assetUid": uid,
                "stockToken": token,
                "stockDecimals": decimals,
                "symbol": source.get("tokenSymbol"),
                "name": source.get("tokenName"),
                "isin": source.get("isin"),
                "officialStatus": status,
                "eligibleByOfficialIdentity": True,
                "enabledForNewMarketsCandidate": status == "ASSET_STATUS_ACTIVE",
            }
        )
    return sorted(normalized, key=lambda entry: entry["assetUid"])


def _chain_snapshot(requested_block_tag: str) -> dict[str, Any]:
    if requested_block_tag not in {"latest", "safe", "finalized"} and not re.fullmatch(
        r"0x[0-9a-fA-F]+", requested_block_tag
    ):
        raise ValueError("block tag must be latest, safe, finalized or a hex block number")
    response = _rpc(
        [
            {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []},
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "eth_getBlockByNumber",
                "params": [requested_block_tag, False],
            },
        ]
    )
    observed_chain_id = int(response[1], 16)
    if observed_chain_id != CHAIN_ID:
        raise ValueError(f"RPC chain mismatch: {observed_chain_id}")
    block = response[2]
    if not isinstance(block, dict):
        raise ValueError(f"RPC returned no block for {requested_block_tag}")
    return {
        "block": int(block["number"], 16),
        "blockTag": block["number"].lower(),
        "blockHash": block["hash"].lower(),
        "timestamp": int(block["timestamp"], 16),
        "requestedBlockTag": requested_block_tag.lower(),
        "finality": (
            "FINALIZED"
            if requested_block_tag == "finalized"
            else "OBSERVATION_NOT_PRODUCTION_FINALITY"
        ),
    }


def _runtime_hash(code: str, name: str) -> tuple[int, str]:
    if not isinstance(code, str) or code in {"0x", "0x0"}:
        raise ValueError(f"no bytecode for {name}")
    raw = bytes.fromhex(code.removeprefix("0x"))
    return len(raw), "0x" + keccak256(raw).hex()


def _immutable_beacon(code: str) -> str | None:
    """Recognize Robinhood's immutable-beacon proxy runtime."""

    raw = bytes.fromhex(code.removeprefix("0x"))
    candidates: list[str] = []
    limit = max(0, len(raw) - 1 - 32 - len(IMMUTABLE_BEACON_SUFFIX) + 1)
    for offset in range(limit):
        if raw[offset] != 0x7F:
            continue
        immediate = raw[offset + 1 : offset + 33]
        suffix = raw[offset + 33 : offset + 33 + len(IMMUTABLE_BEACON_SUFFIX)]
        if (
            len(immediate) == 32
            and immediate[:12] == bytes(12)
            and suffix == IMMUTABLE_BEACON_SUFFIX
        ):
            address = "0x" + immediate[12:].hex()
            if int(address, 16) != 0:
                candidates.append(address)
    unique = sorted(set(candidates))
    if len(unique) > 1:
        raise ValueError("proxy runtime contains multiple immutable beacon candidates")
    return unique[0] if unique else None


def _address_from_abi_word(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX_32.fullmatch(value):
        raise ValueError(f"{name} did not return one ABI address word")
    address = "0x" + value[-40:].lower()
    if int(address, 16) == 0:
        raise ValueError(f"{name} returned the zero address")
    return address


def _verify_onchain(
    assets: list[dict[str, Any]], snapshot: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    call_id = 1
    ids: dict[str, tuple[int, int, int]] = {}
    for asset in assets:
        code_id, decimals_id, uid_id = call_id, call_id + 1, call_id + 2
        ids[asset["assetUid"]] = (code_id, decimals_id, uid_id)
        calls.extend(
            [
                {
                    "jsonrpc": "2.0",
                    "id": code_id,
                    "method": "eth_getCode",
                    "params": [asset["stockToken"], snapshot["blockTag"]],
                },
                {
                    "jsonrpc": "2.0",
                    "id": decimals_id,
                    "method": "eth_call",
                    "params": [
                        {"to": asset["stockToken"], "data": DECIMALS_SELECTOR},
                        snapshot["blockTag"],
                    ],
                },
                {
                    "jsonrpc": "2.0",
                    "id": uid_id,
                    "method": "eth_call",
                    "params": [
                        {"to": asset["stockToken"], "data": UID_SELECTOR},
                        snapshot["blockTag"],
                    ],
                },
            ]
        )
        call_id += 3

    results = _rpc(calls)
    interim: list[tuple[dict[str, Any], str]] = []
    for asset in assets:
        code_id, decimals_id, uid_id = ids[asset["assetUid"]]
        code = results[code_id]
        runtime_bytes, runtime_hash = _runtime_hash(code, asset["assetUid"])
        decimals_raw = results[decimals_id]
        uid_raw = results[uid_id]
        if int(decimals_raw, 16) != asset["stockDecimals"]:
            raise ValueError(f"decimals mismatch for {asset['assetUid']}")
        if uid_raw.lower() != asset["assetUid"]:
            raise ValueError(f"uid() mismatch for {asset['assetUid']}")
        interim.append(
            (
                {
                    **asset,
                    "runtimeBytes": runtime_bytes,
                    "runtimeKeccak256": runtime_hash,
                    "onchainUidVerified": True,
                    "onchainDecimalsVerified": True,
                },
                code,
            )
        )

    beacons = sorted(
        {
            beacon
            for _, code in interim
            if (beacon := _immutable_beacon(code)) is not None
        }
    )
    beacon_evidence: dict[str, dict[str, Any]] = {}
    if beacons:
        beacon_calls: list[dict[str, Any]] = []
        for index, beacon in enumerate(beacons):
            beacon_calls.extend(
                [
                    {
                        "jsonrpc": "2.0",
                        "id": index * 2 + 1,
                        "method": "eth_getCode",
                        "params": [beacon, snapshot["blockTag"]],
                    },
                    {
                        "jsonrpc": "2.0",
                        "id": index * 2 + 2,
                        "method": "eth_call",
                        "params": [
                            {"to": beacon, "data": IMPLEMENTATION_SELECTOR},
                            snapshot["blockTag"],
                        ],
                    },
                ]
            )
        beacon_results = _rpc(beacon_calls)
        implementations: dict[str, str] = {}
        for index, beacon in enumerate(beacons):
            beacon_bytes, beacon_hash = _runtime_hash(
                beacon_results[index * 2 + 1], f"beacon {beacon}"
            )
            implementation = _address_from_abi_word(
                beacon_results[index * 2 + 2],
                f"implementation() for beacon {beacon}",
            )
            implementations[beacon] = implementation
            beacon_evidence[beacon] = {
                "beacon": beacon,
                "runtimeBytes": beacon_bytes,
                "runtimeKeccak256": beacon_hash,
                "implementation": implementation,
            }

        implementation_addresses = sorted(set(implementations.values()))
        implementation_calls = [
            {
                "jsonrpc": "2.0",
                "id": index + 1,
                "method": "eth_getCode",
                "params": [implementation, snapshot["blockTag"]],
            }
            for index, implementation in enumerate(implementation_addresses)
        ]
        implementation_results = _rpc(implementation_calls)
        implementation_evidence: dict[str, tuple[int, str]] = {}
        for index, implementation in enumerate(implementation_addresses):
            implementation_evidence[implementation] = _runtime_hash(
                implementation_results[index + 1],
                f"implementation {implementation}",
            )
        for evidence in beacon_evidence.values():
            runtime_bytes, runtime_hash = implementation_evidence[
                evidence["implementation"]
            ]
            evidence["implementationRuntimeBytes"] = runtime_bytes
            evidence["implementationRuntimeKeccak256"] = runtime_hash

    verified: list[dict[str, Any]] = []
    unrecognized_count = 0
    for asset, code in interim:
        beacon = _immutable_beacon(code)
        if beacon is None:
            unrecognized_count += 1
            upgradeability = {
                "kind": "UNRECOGNIZED_RUNTIME_REQUIRES_REVIEW",
            }
            implementation_verified = False
        else:
            evidence = beacon_evidence[beacon]
            upgradeability = {
                "kind": "IMMUTABLE_BEACON_PROXY",
                "beacon": beacon,
                "beaconRuntimeKeccak256": evidence["runtimeKeccak256"],
                "implementation": evidence["implementation"],
                "implementationRuntimeKeccak256": evidence[
                    "implementationRuntimeKeccak256"
                ],
            }
            implementation_verified = True
        verified.append(
            {
                **asset,
                "upgradeability": upgradeability,
                "implementationFingerprintVerified": implementation_verified,
            }
        )

    confirmation = _rpc(
        [
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "eth_getBlockByNumber",
                "params": [snapshot["blockTag"], False],
            }
        ]
    )[1]
    if (
        not isinstance(confirmation, dict)
        or confirmation.get("hash", "").lower() != snapshot["blockHash"]
    ):
        raise ValueError("fixed block hash changed or could not be reconfirmed")

    return verified, {
        "recognizedImmutableBeaconProxyCount": len(verified) - unrecognized_count,
        "unrecognizedRuntimeCount": unrecognized_count,
        "allImplementationFingerprintsPassed": unrecognized_count == 0,
        "beacons": [beacon_evidence[key] for key in sorted(beacon_evidence)],
    }


def build_snapshot(
    source_raw: bytes | None = None,
    *,
    requested_block_tag: str = "latest",
    source_archive: str | None = None,
) -> dict[str, Any]:
    captured_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    if source_raw is None:
        source_raw = _request(ASSET_API)
    source_payload = json.loads(source_raw)
    assets = _base_assets(source_payload)
    snapshot = _chain_snapshot(requested_block_tag)
    assets, upgradeability = _verify_onchain(assets, snapshot)
    normalized = json.dumps(assets, sort_keys=True, separators=(",", ":")).encode()
    statuses = Counter(asset["officialStatus"] for asset in assets)
    decimals = Counter(str(asset["stockDecimals"]) for asset in assets)
    symbols = [asset["symbol"] for asset in assets]
    catalog_status = (
        "ELIGIBILITY_POLICY_APPROVED_IDENTITY_SNAPSHOT_FINALIZED"
        if snapshot["finality"] == "FINALIZED"
        else "ELIGIBILITY_POLICY_APPROVED_IDENTITY_SNAPSHOT_OBSERVED"
    )
    return {
        "schemaVersion": 1,
        "executionSpecId": EXECUTION_SPEC_ID,
        "status": catalog_status,
        "chainId": CHAIN_ID,
        "source": {
            "kind": "ROBINHOOD_OFFICIAL_STOCK_TOKEN_DIRECTORY",
            "url": ASSET_API,
            "capturedAt": captured_at,
            "responseBytes": len(source_raw),
            "responseSha256": "0x" + hashlib.sha256(source_raw).hexdigest(),
            "rawResponseArchived": source_archive is not None,
            "rawResponseArchive": source_archive,
        },
        "chainSnapshot": snapshot,
        "policy": {
            "eligibilityRule": "EVERY_ASSET_RETURNED_BY_THE_OFFICIAL_DIRECTORY_WITH_A_CHAIN_4663_DEPLOYMENT",
            "identityTuple": ["chainId", "assetUid", "stockToken", "stockDecimals"],
            "symbolOrNameIsIdentity": False,
            "runtimeHttpDependency": False,
            "catalogCountIsProtocolCap": False,
            "futureOfficialAssetsEligibleUnderSameRule": True,
            "inactiveIdentityTreatment": "REMAINS_OFFICIAL_BUT_PAUSE_NEW_MARKETS_AND_NEW_ALLOCATION",
            "historicalMarketsAndPrincipalExitUnaffected": True,
            "productionRegistration": "PER_ASSET_TIMELOCKED_REGISTRY_CALLS_NO_BATCH_ABI",
            "productionSnapshotRequirement": "FINALIZED_BLOCK_WITH_HISTORICAL_STATE_CAPABLE_RPC",
            "proxyImplementationFingerprintRequiredBeforeRegistration": True,
            "allActiveAssetsSelectableAsStakingBase": True,
            "marketStakingBaseCardinality": "EXACTLY_ONE_ASSET_UID",
            "stakingBaseSelectedBy": "MARKET_CREATOR_AT_MARKET_CREATION",
            "stakingBaseImmutableAfterCreation": True,
            "sameStockMayBackUnlimitedMarkets": True,
            "stockHolderChoice": "ALLOCATE_OR_NOT_ALLOCATE_OWN_BASE_STOCK_TO_ANY_MATCHING_GRADUATED_MARKET",
            "stockPriceRequired": False,
            "stockPriceOracleDependency": False,
            "priceFeedCoverageAffectsEligibility": False,
            "backingTargetRequired": False,
        },
        "summary": {
            "assetCount": len(assets),
            "uniqueAssetUidCount": len({asset["assetUid"] for asset in assets}),
            "uniqueTokenCount": len({asset["stockToken"] for asset in assets}),
            "uniqueSymbolCount": len(set(symbols)),
            "officialStatusCounts": dict(sorted(statuses.items())),
            "stockDecimalsCounts": dict(sorted(decimals.items())),
            "allIdentityChecksPassed": True,
            "allImplementationFingerprintsPassed": upgradeability[
                "allImplementationFingerprintsPassed"
            ],
            "normalizedCatalogKeccak256": "0x" + keccak256(normalized).hex(),
        },
        "upgradeabilityEvidence": upgradeability,
        "assets": assets,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", type=Path)
    parser.add_argument("--write-source", type=Path)
    parser.add_argument(
        "--block-tag",
        default="latest",
        help="latest for an observation; production capture must use finalized",
    )
    parser.add_argument(
        "--rpc-url",
        default=PUBLIC_RPC,
        help="RPC endpoint; finalized production capture requires historical state",
    )
    arguments = parser.parse_args()
    if arguments.write_source and not arguments.write:
        parser.error("--write-source requires --write")
    PUBLIC_RPC = arguments.rpc_url
    source_raw = _request(ASSET_API)
    source_archive = None
    if arguments.write_source:
        try:
            source_archive = str(
                arguments.write_source.relative_to(arguments.write.parent)
            )
        except ValueError:
            source_archive = str(arguments.write_source)
    rendered = json.dumps(
        build_snapshot(
            source_raw,
            requested_block_tag=arguments.block_tag,
            source_archive=source_archive,
        ),
        indent=2,
        ensure_ascii=False,
    ) + "\n"
    if arguments.write:
        if arguments.write_source:
            arguments.write_source.write_bytes(source_raw)
        arguments.write.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
