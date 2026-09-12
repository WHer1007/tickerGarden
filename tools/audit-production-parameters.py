"""Read-only consistency audit of the selected RH mainnet candidate (no RPC or secrets)."""
import hashlib
import json
import re
from decimal import Decimal, ROUND_HALF_UP, getcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
getcontext().prec = 100


def read(relative):
    return json.loads((ROOT / relative).read_text())


def audit():
    quote_path = "deployments/manifests/robinhood-mainnet-4663.paired-assets.json"
    stake_path = "deployments/manifests/robinhood-mainnet-4663.staking-assets.json"
    price_path = "docs/references/data/rh-all-stock-quote-thresholds-2026-09-12/thresholds.json"
    quotes = read(quote_path)
    stakes = read(stake_path)
    prices = read(price_path)
    assert quotes["chainId"] == stakes["chainId"] == 4663
    assert len(quotes["assets"]) == 196 and len(stakes["assets"]) == 194
    q = {a["tokenAddress"].lower(): a for a in quotes["assets"]}
    st = {a["tokenAddress"].lower(): a for a in stakes["assets"]}
    assert len(q) == 196 and len(st) == 194
    assert len({a["assetUid"] for a in st.values()}) == 194
    by_symbol = {a["symbol"]: a for a in quotes["assets"]}
    assert int(by_symbol["ETH"]["graduationThreshold"]) == 3 * 10**18
    assert int(by_symbol["ETH"]["phantomQuote"]) == 12 * 10**17
    assert by_symbol["USDG"]["decimals"] == 6
    assert int(by_symbol["USDG"]["graduationThreshold"]) == 7000 * 10**6
    assert int(by_symbol["USDG"]["phantomQuote"]) == 2800 * 10**6
    for a in q.values():
        assert 6 <= a["decimals"] <= 18
        threshold, phantom = int(a["graduationThreshold"]), int(a["phantomQuote"])
        assert 0 < threshold <= 2**127 - 1 and 0 < phantom <= 2**127 - 1
        assert phantom * 5 == threshold * 2, a["symbol"]
    for addr, a in st.items():
        assert a["decimals"] == 18 and int(a["minimumAllocation"]) == 5 * 10**17
        assert int(a["minimumAllocation"]) >= 414
        assert q[addr]["assetUid"] == a["assetUid"]
    assert len(prices["assets"]) == 194
    for a in prices["assets"]:
        price = (Decimal(a["bid"]) + Decimal(a["ask"])) / 2 * Decimal(a["multiplier"])
        assert price == Decimal(a["referencePriceUsd"])
        threshold = (Decimal(7000) / price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        assert threshold == Decimal(a["graduationThresholdTokens"]), a["symbol"]
        assert int(threshold * 10**18) == int(q[a["tokenAddress"].lower()]["graduationThreshold"])
        assert Decimal(a["phantomQuoteTokens"]) == threshold * Decimal("0.4")

    constants = []
    sources = {}
    for path in sorted((ROOT / "contracts/src/v1").rglob("*.sol")):
        relative = str(path.relative_to(ROOT))
        source = path.read_text()
        sources[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        for match in re.finditer(r"\b(?:uint\d*|int\d*|bytes\d*|address|bool)\s+(?:(?:public|private|internal)\s+)?constant\s+(\w+)\s*=\s*([^;]+);", source):
            constants.append({"file": relative, "line": source[:match.start()].count("\n") + 1,
                              "name": match[1], "expression": match[2].strip()})
    env = {}
    for line in (ROOT / "config/master.env.example").read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            env[key] = val.strip("'\"")
    assert env["TG_RUNTIME_CONFIGURED"] == "false"
    assert int(env["V1_NATIVE_PHANTOM_WEI"]) == 12 * 10**17
    assert int(env["V1_NATIVE_GRADUATION_WEI"]) == 3 * 10**18
    policy = read("spec/v1_execution_manifest.json")["platformTreasuryRotation"]
    assert policy["stateDelaySeconds"] == 172800 and policy["oldRecipientConsentRequired"] is False
    canonical = read("spec/v1_canonical_abi.json")
    delayed = [(x["module"], x["displaySignature"], x["stateDelaySeconds"]) for x in canonical["mutations"] if x["stateDelaySeconds"]]
    assert delayed == [("ProtocolFeeVault", "executePlatformTreasury(uint256)", 172800)]
    return {
        "status": "LOCAL_PARAMETER_CONSISTENCY_PASSED_NOT_PRODUCTION_READY",
        "quoteCount": len(q), "stakeCount": len(st), "stockPriceCalculationsChecked": len(prices["assets"]),
        "inputs": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in [quote_path, stake_path, price_path, "config/master.env.example", "spec/v1_numeric_bounds.json", "spec/v1_execution_manifest.json"]},
        "templateParameters": env, "unconfiguredTemplateKeys": [k for k, v in env.items() if not v],
        "treasuryPolicy": policy, "numericBounds": read("spec/v1_numeric_bounds.json"),
        "solidityConstants": constants, "sourceSha256": sources,
        "limitations": ["No secret env files read", "No deployed Safe or live Registry validation", "Price snapshot is dated, not a live market quote", "Constants include internal bounds and identifiers, not only configurable business settings"]
    }


if __name__ == "__main__":
    print(json.dumps(audit(), indent=2, ensure_ascii=False))
