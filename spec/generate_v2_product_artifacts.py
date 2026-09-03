import argparse
import hashlib
import json
from pathlib import Path

from generate_v2_hash_vectors import keccak256


ROOT = Path(__file__).resolve().parents[1]
MODULES_ROOT = ROOT / "contracts/src/v2/modules"
ARTIFACT_ROOT = ROOT / "contracts/out-v2"
INTERFACE_ARTIFACT_ROOT = ARTIFACT_ROOT / "IV2Protocol.sol"
OUTPUT_PATH = ROOT / "spec/v2_product_artifact_manifest.json"
ABI_SURFACE_PATH = ROOT / "spec/v2_abi_surface.json"


def sha256_bytes(payload):
    return "0x" + hashlib.sha256(payload).hexdigest()


def canonical_hash(value):
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return sha256_bytes(payload)


def canonical_type(parameter):
    type_name = parameter["type"]
    if not type_name.startswith("tuple"):
        return type_name
    suffix = type_name[len("tuple") :]
    return "(" + ",".join(canonical_type(component) for component in parameter["components"]) + ")" + suffix


def signature(entry):
    return entry["name"] + "(" + ",".join(canonical_type(value) for value in entry.get("inputs", [])) + ")"


def function_shape(entry):
    return {
        "signature": signature(entry),
        "stateMutability": entry["stateMutability"],
        "inputs": [canonical_type(value) for value in entry.get("inputs", [])],
        "outputs": [canonical_type(value) for value in entry.get("outputs", [])],
    }


def event_shape(entry):
    return {
        "signature": signature(entry),
        "inputs": [
            {"type": canonical_type(value), "indexed": value["indexed"]}
            for value in entry.get("inputs", [])
        ],
    }


def entries(abi, entry_type):
    return [entry for entry in abi if entry.get("type") == entry_type]


def code_identity(bytecode):
    value = bytecode["object"]
    if value.startswith("0x"):
        value = value[2:]
    payload = bytes.fromhex(value)
    return {"bytes": len(payload), "keccak256": "0x" + keccak256(payload).hex()}


def validate_abi(module, actual_abi, expected_abi):
    actual_functions = {signature(entry): function_shape(entry) for entry in entries(actual_abi, "function")}
    expected_functions = {signature(entry): function_shape(entry) for entry in entries(expected_abi, "function")}
    for function_signature, expected in expected_functions.items():
        if actual_functions.get(function_signature) != expected:
            raise ValueError(f"{module} function mismatch: {function_signature}")

    actual_mutations = {
        key for key, value in actual_functions.items() if value["stateMutability"] not in ("view", "pure")
    }
    expected_mutations = {
        key for key, value in expected_functions.items() if value["stateMutability"] not in ("view", "pure")
    }
    if actual_mutations != expected_mutations:
        raise ValueError(
            f"{module} mutation ABI mismatch: expected {sorted(expected_mutations)}, got {sorted(actual_mutations)}"
        )

    actual_events = {signature(entry): event_shape(entry) for entry in entries(actual_abi, "event")}
    expected_events = {signature(entry): event_shape(entry) for entry in entries(expected_abi, "event")}
    if actual_events != expected_events:
        raise ValueError(f"{module} event ABI mismatch")
    return actual_functions, actual_mutations, actual_events


def build():
    surface = json.loads(ABI_SURFACE_PATH.read_text(encoding="utf-8"))
    canonical_modules = {module["module"] for module in surface["modules"]}
    source_paths = sorted(MODULES_ROOT.glob("*.sol"))
    modules = []
    for source_path in source_paths:
        module = source_path.stem
        if module not in canonical_modules:
            raise ValueError(f"non-canonical product module source: {source_path.relative_to(ROOT)}")
        artifact_path = ARTIFACT_ROOT / source_path.name / f"{module}.json"
        interface_artifact_path = INTERFACE_ARTIFACT_ROOT / f"I{module}.json"
        if not artifact_path.exists() or not interface_artifact_path.exists():
            raise ValueError(f"missing product or interface artifact for {module}")
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        interface_artifact = json.loads(interface_artifact_path.read_text(encoding="utf-8"))
        source_relative = str(source_path.relative_to(ROOT))
        if source_relative.removeprefix("contracts/") not in artifact["metadata"]["sources"]:
            raise ValueError(f"{module} artifact metadata does not identify {source_relative}")
        functions, mutations, events = validate_abi(module, artifact["abi"], interface_artifact["abi"])
        modules.append(
            {
                "module": module,
                "source": source_relative,
                "sourceSha256": sha256_bytes(source_path.read_bytes()),
                "artifact": str(artifact_path.relative_to(ROOT)),
                "interfaceArtifact": str(interface_artifact_path.relative_to(ROOT)),
                "compilerVersion": artifact["metadata"]["compiler"]["version"],
                "creationCode": code_identity(artifact["bytecode"]),
                "runtimeTemplate": {
                    **code_identity(artifact["deployedBytecode"]),
                    "immutableReferenceGroups": len(
                        artifact["deployedBytecode"].get("immutableReferences", {})
                    ),
                    "isFinalDeploymentCodeHash": False,
                },
                "functions": sorted(functions),
                "mutations": sorted(mutations),
                "events": sorted(events),
            }
        )
    if not modules:
        raise ValueError("no concrete V2 product modules found")
    manifest = {
        "schemaVersion": 1,
        "executionSpecId": surface["executionSpecId"],
        "status": "PRODUCT_ARTIFACTS_COMPILED_NOT_DEPLOYMENT_EVIDENCE",
        "modules": modules,
    }
    manifest["manifestHash"] = canonical_hash(manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = build()
    rendered = json.dumps(manifest, indent=2) + "\n"
    if args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"{OUTPUT_PATH.relative_to(ROOT)} is stale; regenerate it")
        print(
            f"V2 product artifact manifest verified: {len(manifest['modules'])} module(s), "
            f"{manifest['manifestHash']}"
        )
        return
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    print(f"wrote {OUTPUT_PATH.relative_to(ROOT)} ({manifest['manifestHash']})")


if __name__ == "__main__":
    main()
