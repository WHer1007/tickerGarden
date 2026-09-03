"""Retired V2-EXEC-1 Chainlink directory research capture.

This is historical offchain evidence only. It is not an input to V2-EXEC-3 and
does not affect official STOCK eligibility, market creation, staking weight,
fee distribution or readiness. See RETIRED_STOCK_PRICE_RESEARCH.md.
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
from pathlib import Path
from typing import Any

try:
    from spec.generate_v2_hash_vectors import keccak256
except ModuleNotFoundError:
    from generate_v2_hash_vectors import keccak256


CHAIN_ID = 4663
EXECUTION_SPEC_ID = "V2-EXEC-1"
FEED_DIRECTORY_URL = (
    "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json"
)
HEX_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


def _request() -> bytes:
    request = urllib.request.Request(
        FEED_DIRECTORY_URL,
        headers={"User-Agent": "TickerGarden-V2-Feed-Directory-Capture/1.0"},
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


def _address(value: Any, name: str) -> str:
    if not isinstance(value, str) or not HEX_ADDRESS.fullmatch(value):
        raise ValueError(f"{name} is not an address")
    value = value.lower()
    if int(value, 16) == 0:
        raise ValueError(f"{name} is the zero address")
    return value


def _feed_symbol(name: Any) -> str | None:
    if not isinstance(name, str) or not name.startswith("Robinhood "):
        return None
    pair = re.sub(r"\s+", "", name.removeprefix("Robinhood ")).replace("/", "-")
    match = re.fullmatch(r"(.+)-USD", pair, flags=re.IGNORECASE)
    return None if match is None else match.group(1).upper()


def build(
    catalog: dict[str, Any],
    source_raw: bytes,
    *,
    source_archive: str | None = None,
) -> dict[str, Any]:
    if catalog.get("chainId") != CHAIN_ID:
        raise ValueError("official STOCK catalog chainId mismatch")
    official_catalog_hash = catalog.get("summary", {}).get(
        "normalizedCatalogKeccak256"
    )
    if (
        not isinstance(official_catalog_hash, str)
        or not re.fullmatch(r"0x[0-9a-f]{64}", official_catalog_hash)
        or int(official_catalog_hash, 16) == 0
    ):
        raise ValueError("official STOCK catalog hash is missing")
    catalog_assets = catalog.get("assets")
    if not isinstance(catalog_assets, list) or not catalog_assets:
        raise ValueError("official STOCK catalog is empty")
    by_symbol: dict[str, dict[str, Any]] = {}
    for asset in catalog_assets:
        symbol = asset.get("symbol")
        if not isinstance(symbol, str) or not symbol:
            raise ValueError("official STOCK catalog contains an invalid symbol")
        symbol = symbol.upper()
        if symbol in by_symbol:
            raise ValueError(f"official STOCK catalog symbol collision: {symbol}")
        by_symbol[symbol] = asset

    payload = json.loads(source_raw)
    if not isinstance(payload, list) or not payload:
        raise ValueError("Chainlink feed directory must be a nonempty array")
    seen_primary: set[str] = set()
    mappings: list[dict[str, Any]] = []
    non_stock_feed_count = 0
    unmatched_robinhood_names: list[str] = []
    for entry in payload:
        if not isinstance(entry, dict):
            raise ValueError("Chainlink feed directory contains a non-object entry")
        primary = _address(entry.get("proxyAddress"), "primary feed proxy")
        if primary in seen_primary:
            raise ValueError(f"duplicate primary feed proxy: {primary}")
        seen_primary.add(primary)
        symbol = _feed_symbol(entry.get("name"))
        if symbol is None:
            non_stock_feed_count += 1
            continue
        asset = by_symbol.get(symbol)
        if asset is None:
            unmatched_robinhood_names.append(entry["name"])
            continue
        decimals = entry.get("decimals")
        heartbeat = entry.get("heartbeat")
        if type(decimals) is not int or not 0 <= decimals <= 36:
            raise ValueError(f"invalid decimals for {entry['name']}")
        if type(heartbeat) is not int or heartbeat <= 0:
            raise ValueError(f"invalid heartbeat for {entry['name']}")
        secondary_raw = entry.get("secondaryProxyAddress")
        secondary = (
            None
            if secondary_raw in {None, ""}
            else _address(secondary_raw, "secondary feed proxy")
        )
        mappings.append(
            {
                "assetUid": asset["assetUid"].lower(),
                "stockToken": asset["stockToken"].lower(),
                "symbol": symbol,
                "feedName": entry["name"],
                "primaryFeedProxy": primary,
                "secondaryFeedProxy": secondary,
                "feedDecimals": decimals,
                "heartbeatSeconds": heartbeat,
                "directoryEntrySha256": "0x"
                + hashlib.sha256(
                    json.dumps(
                        entry, sort_keys=True, separators=(",", ":")
                    ).encode()
                ).hexdigest(),
                "mappingMethod": "PROPOSED_FROM_EXACT_OFFICIAL_SYMBOL_AND_FEED_NAME_REQUIRES_GOVERNANCE_REVIEW",
            }
        )

    mappings.sort(key=lambda item: item["assetUid"])
    mapped_uids = {item["assetUid"] for item in mappings}
    missing = [
        {
            "assetUid": asset["assetUid"].lower(),
            "stockToken": asset["stockToken"].lower(),
            "symbol": asset["symbol"],
        }
        for asset in catalog_assets
        if asset["assetUid"].lower() not in mapped_uids
    ]
    missing.sort(key=lambda item: item["assetUid"])
    normalized = json.dumps(
        mappings, sort_keys=True, separators=(",", ":")
    ).encode()
    return {
        "schemaVersion": 1,
        "executionSpecId": EXECUTION_SPEC_ID,
        "status": "OBSERVED_CANONICAL_DIRECTORY_NOT_PRODUCTION_APPROVED",
        "chainId": CHAIN_ID,
        "officialCatalogHash": official_catalog_hash,
        "capturedAt": dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "source": {
            "kind": "CHAINLINK_REFERENCE_DATA_DIRECTORY_ROBINHOOD_MAINNET",
            "url": FEED_DIRECTORY_URL,
            "responseBytes": len(source_raw),
            "responseSha256": "0x" + hashlib.sha256(source_raw).hexdigest(),
            "rawResponseArchived": source_archive is not None,
            "rawResponseArchive": source_archive,
        },
        "policy": {
            "primaryProxyOnlyForTargetGeneration": True,
            "secondaryProxyNotSilentlySubstitutable": True,
            "symbolUsedToProposeMappingNotAsStockIdentity": True,
            "mappingIdentity": ["chainId", "assetUid", "stockToken", "primaryFeedProxy"],
            "missingFeedDoesNotRevokeOfficialStockEligibility": True,
            "missingFeedBlocksUniformUsdTargetGeneration": True,
        },
        "summary": {
            "directoryFeedCount": len(payload),
            "uniquePrimaryProxyCount": len(seen_primary),
            "mappedOfficialStockFeedCount": len(mappings),
            "officialStockWithoutMappedFeedCount": len(missing),
            "nonRobinhoodOrNonStockFeedCount": non_stock_feed_count,
            "unmatchedRobinhoodFeedNameCount": len(unmatched_robinhood_names),
            "normalizedMappingKeccak256": "0x" + keccak256(normalized).hex(),
        },
        "unmatchedRobinhoodFeedNames": sorted(unmatched_robinhood_names),
        "mappings": mappings,
        "officialStocksWithoutMappedFeed": missing,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--write", type=Path)
    parser.add_argument("--write-source", type=Path)
    arguments = parser.parse_args()
    if arguments.write_source and not arguments.write:
        parser.error("--write-source requires --write")
    catalog_document = json.loads(arguments.catalog.read_text(encoding="utf-8"))
    source_raw = _request()
    source_archive = None
    if arguments.write_source:
        try:
            source_archive = str(
                arguments.write_source.relative_to(arguments.write.parent)
            )
        except ValueError:
            source_archive = str(arguments.write_source)
    rendered = json.dumps(
        build(catalog_document, source_raw, source_archive=source_archive),
        indent=2,
        ensure_ascii=False,
    ) + "\n"
    if arguments.write:
        if arguments.write_source:
            arguments.write_source.write_bytes(source_raw)
        arguments.write.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
