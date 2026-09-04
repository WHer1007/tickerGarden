import argparse
import hashlib
import json
from pathlib import Path

from generate_v1_hash_vectors import keccak256


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "contracts/test/v1/fixtures/v1-fork-fixtures.json"
SOURCE_PATHS = (
    "spec/v1_initial_quote_configs.json",
    "spec/v1_pons_behavior_vectors.json",
    "spec/v1_pons_runtime_evidence.json",
)
MOCK_SOURCE = "contracts/test/v1/mocks/MockV1QuoteAssets.sol"
ARTIFACT_ROOT = ROOT / "contracts/out-v1/MockV1QuoteAssets.sol"


def read_json(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def sha256_file(relative_path):
    return "0x" + hashlib.sha256((ROOT / relative_path).read_bytes()).hexdigest()


def canonical_hash(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return "0x" + hashlib.sha256(encoded).hexdigest()


def runtime_identity(contract_name):
    artifact_path = ARTIFACT_ROOT / f"{contract_name}.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    runtime_hex = artifact["deployedBytecode"]["object"]
    if not runtime_hex.startswith("0x"):
        runtime_hex = "0x" + runtime_hex
    if artifact["deployedBytecode"].get("immutableReferences"):
        raise ValueError(f"{contract_name} runtime contains unresolved immutables")
    runtime = bytes.fromhex(runtime_hex[2:])
    return {
        "artifact": str(artifact_path.relative_to(ROOT)),
        "runtimeBytes": len(runtime),
        "runtimeKeccak256": "0x" + keccak256(runtime).hex(),
    }


def quote_fixture(config):
    fixture = {
        key: config[key]
        for key in (
            "label",
            "assetKind",
            "symbol",
            "quoteAssetConfigId",
            "quoteAsset",
            "quoteDecimals",
            "phantomQuote",
            "graduationThreshold",
            "economicsHash",
            "status",
        )
    }
    fixture["runtime"] = (
        {
            "kind": "NATIVE_SENTINEL",
            "runtimeBytes": 0,
            "runtimeKeccak256": "0x" + keccak256(b"").hex(),
        }
        if config["assetKind"] == "NATIVE"
        else {
            "kind": "IMMUTABLE_DIRECT_ERC20",
            "runtimeBytes": config["assetReview"]["runtimeBytes"],
            "runtimeKeccak256": config["assetReview"]["runtimeKeccak256"],
            "implementation": config["quoteAsset"],
            "implementationRuntimeKeccak256": config["assetReview"]["runtimeKeccak256"],
            "proxyKind": "NONE",
            "eip1967SlotsZeroRequired": True,
        }
    )
    return fixture


def malicious_fixture(identifier, contract_name, behavior, expected):
    return {
        "id": identifier,
        "contract": contract_name,
        "behavior": behavior,
        "expected": expected,
        "runtime": runtime_identity(contract_name),
    }


def build():
    quotes = read_json(SOURCE_PATHS[0])
    vectors = read_json(SOURCE_PATHS[1])
    runtime = read_json(SOURCE_PATHS[2])
    if len({quotes["executionSpecId"], vectors["executionSpecId"], runtime["executionSpecId"]}) != 1:
        raise ValueError("execution spec identities differ")
    if vectors["baselineId"] != runtime["baselineId"]:
        raise ValueError("Pons baseline identities differ")

    fixture = {
        "schemaVersion": 1,
        "executionSpecId": quotes["executionSpecId"],
        "fixtureSetId": "V1-E-105-A",
        "status": "FIXTURE_BASELINE_ONLY_NOT_LIVE_FORK_EVIDENCE",
        "sourceFiles": [
            {"path": relative_path, "sha256": sha256_file(relative_path)}
            for relative_path in SOURCE_PATHS
        ]
        + [{"path": MOCK_SOURCE, "sha256": sha256_file(MOCK_SOURCE)}],
        "forkSnapshots": {
            "ponsBehavior": {
                **vectors["reference"],
                "archiveForkRequired": True,
            },
            "initialQuoteReview": {
                "chainId": quotes["chainId"],
                **quotes["evidenceSnapshot"],
                "archiveForkRequired": True,
            },
        },
        "quoteFixtures": [quote_fixture(config) for config in quotes["configs"]],
        "ponsBehavior": {
            "baselineId": vectors["baselineId"],
            "launch": vectors["launch"],
            "vectors": vectors["vectors"],
            "vectorCount": len(vectors["vectors"]),
            "sourceDocumentSha256": sha256_file(SOURCE_PATHS[1]),
        },
        "assetBehaviorFixtures": [
            malicious_fixture(
                "EXACT_ERC20_6_DECIMALS",
                "MockExactQuoteToken",
                {"quoteDecimals": 6, "exactBalanceDelta": True},
                "ACCEPT_LOCAL_CONTROL",
            ),
            malicious_fixture(
                "FEE_ON_TRANSFER_100_BPS",
                "MockFeeOnTransferQuoteToken",
                {"quoteDecimals": 6, "feeBps": 100},
                "REJECT_AND_ROLL_BACK_INEXACT_DELTA",
            ),
            malicious_fixture(
                "REBASING_BALANCE_DRIFT",
                "MockRebasingQuoteToken",
                {"quoteDecimals": 6, "balanceCanChangeWithoutTransfer": True},
                "REJECT_AS_QUOTE_ASSET",
            ),
            malicious_fixture(
                "TRANSFER_CALLBACK_REENTRANCY",
                "MockCallbackQuoteToken",
                {"quoteDecimals": 6, "recipientCallback": True},
                "REJECT_AND_ROLL_BACK_CALLBACK",
            ),
            malicious_fixture(
                "TRANSFER_RETURN_FALSE",
                "MockReturnAnomalyQuoteToken",
                {"returnMode": "FALSE"},
                "REJECT_INVALID_RETURN",
            ),
            malicious_fixture(
                "TRANSFER_RETURN_NO_DATA",
                "MockReturnAnomalyQuoteToken",
                {"returnMode": "NO_DATA"},
                "REJECT_INVALID_RETURN",
            ),
            malicious_fixture(
                "TRANSFER_RETURN_MALFORMED_TRUE",
                "MockReturnAnomalyQuoteToken",
                {"returnMode": "MALFORMED_TRUE", "encodedValue": 2},
                "REJECT_INVALID_RETURN",
            ),
            malicious_fixture(
                "FORCED_NATIVE_TRANSFER",
                "MockForcedNativeSender",
                {"canIncreaseRecipientBalanceOutsideControlledPayment": True},
                "DO_NOT_CREDIT_AS_BUSINESS_PAYMENT",
            ),
        ],
        "policies": {
            "oneQuotePerMarket": True,
            "nativeBuyMsgValueEqualsQuoteIn": True,
            "erc20BuyMsgValueEqualsZero": True,
            "erc20ExactBalanceDeltaRequired": True,
            "feeOnTransferAccepted": False,
            "rebasingAccepted": False,
            "arbitraryTransferCallbacksAccepted": False,
            "nonCanonicalTransferReturnsAccepted": False,
            "runtimeDependencyOnPons": False,
            "referenceCreate2ValuesAreProductionDeploymentEvidence": False,
        },
    }
    fixture["fixtureSetHash"] = canonical_hash(fixture)
    return fixture


def validate(fixture):
    if fixture["ponsBehavior"]["vectorCount"] != 14:
        raise ValueError("expected exactly 14 approved Pons behavior vectors")
    if len(fixture["quoteFixtures"]) != 1:
        raise ValueError("expected exactly one native initial Quote fixture")
    for quote in fixture["quoteFixtures"]:
        if quote["quoteAssetConfigId"] != quote["economicsHash"]:
            raise ValueError(f"{quote['label']} config id differs from economics hash")
    expected_hash = canonical_hash({key: value for key, value in fixture.items() if key != "fixtureSetHash"})
    if fixture["fixtureSetHash"] != expected_hash:
        raise ValueError("fixtureSetHash mismatch")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    fixture = build()
    validate(fixture)
    rendered = json.dumps(fixture, indent=2) + "\n"
    if args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"{OUTPUT_PATH.relative_to(ROOT)} is stale; regenerate it")
        print(f"V1 fixture manifest verified: {fixture['fixtureSetHash']}")
        return
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    print(f"wrote {OUTPUT_PATH.relative_to(ROOT)} ({fixture['fixtureSetHash']})")


if __name__ == "__main__":
    main()
