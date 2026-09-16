#!/usr/bin/env python3
"""Compile the V1 event ABI into the backend's deterministic JSON catalog."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "spec/v1_product_artifact_manifest.json"
CANONICAL = ROOT / "spec/v1_canonical_abi.json"
TS_CATALOG = ROOT / "services/backend-go/testsupport/projection/generated/v1-events.ts"
OUTPUT = ROOT / "services/backend-go/internal/events/catalog.json"
ALLOWED = re.compile(r"^(?:bytes32|address|bool|uint(?:\d+)?|int(?:\d+)?)$")

sys.path.insert(0, str(ROOT / "spec"))
from generate_v1_hash_vectors import keccak256  # noqa: E402


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def signature(item):
    return f"{item['name']}({','.join(x['type'] for x in item['inputs'])})"


def ts_events():
    text = TS_CATALOG.read_text(encoding="utf-8")
    match = re.search(r"export const V1_EVENT_ABI = \[(.*)\] as const", text, re.S)
    if not match:
        raise ValueError("cannot locate TypeScript event catalog")
    result = {}
    for block in re.findall(r"\{\n    signature: \"([^\"]+)", match.group(1)):
        start = match.group(1).find('signature: "' + block + '"')
        chunk = match.group(1)[start:]
        chunk = chunk[:chunk.find("\n  },")]
        name = re.search(r'name: "([^\"]+)"', chunk).group(1)
        modules = json.loads(re.search(r"modules: (\[[^\n]+\])", chunk).group(1))
        inputs = json.loads(re.search(r"inputs: (\[[^\n]+\])", chunk).group(1))
        result[block] = {"name": name, "modules": sorted(modules), "inputs": inputs}
    return result


def build():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    canonical = json.loads(CANONICAL.read_text(encoding="utf-8"))
    canonical_events = {x["canonicalSignature"]: x for x in canonical["events"]}
    by_sig = {}
    source_paths = [MANIFEST, CANONICAL, ROOT / "spec/v1_abi_surface.json", ROOT / "spec/v1_permissions_matrix.json", ROOT / "spec/generate_v1_hash_vectors.py", TS_CATALOG]
    sources = []
    for entry in manifest["modules"] + manifest.get("extensionModules", []):
        sources.append((entry["module"], ROOT / (entry.get("interfaceArtifact") or entry["artifact"])))
        source_paths.append(ROOT / entry["source"])
    sources.append(("UniswapV4PoolManager", ROOT / "contracts/out-v1/IPoolManager.sol/IPoolManager.json"))
    for module, path in sources:
        artifact = json.loads(path.read_text(encoding="utf-8"))
        for item in artifact["abi"]:
            if item.get("type") != "event" or (module == "UniswapV4PoolManager" and item["name"] not in {"Donate", "Swap"}):
                continue
            sig = signature(item)
            inputs = [{"name": x["name"], "type": x["type"], "indexed": bool(x.get("indexed", False))} for x in item["inputs"]]
            if any(not ALLOWED.fullmatch(x["type"]) for x in inputs):
                raise ValueError(f"unsupported event input type in {sig}")
            old = by_sig.get(sig)
            if old and old["inputs"] != inputs:
                raise ValueError(f"conflicting event definition for {sig}")
            if old:
                old["modules"].add(module)
            else:
                by_sig[sig] = {"signature": sig, "name": item["name"], "modules": {module}, "inputs": inputs}
    events = []
    for sig in sorted(by_sig):
        event = by_sig[sig]
        expected = canonical_events.get(sig)
        topic = "0x" + keccak256(sig.encode()).hex()
        if expected and expected["topic0"] != topic:
            raise ValueError(f"canonical topic mismatch for {sig}")
        event["topic0"] = expected["topic0"] if expected else topic
        event["modules"] = sorted(event["modules"])
        events.append(event)
    ts = ts_events()
    actual = {e["signature"]: {"name": e["name"], "modules": e["modules"], "inputs": e["inputs"]} for e in events}
    if actual != ts:
        raise ValueError("TypeScript event catalog drift detected")
    source_paths += [p for _, p in sources]
    source_paths += list((ROOT / "contracts/src/v1").rglob("*.sol"))
    source_paths += list((ROOT / "docs/v1").glob("*.md"))
    source_map = {}
    for p in sorted(set(source_paths), key=lambda x: str(x)):
        relative = str(p.relative_to(ROOT))
        if relative.startswith("contracts/out-v1/"):
            encoded = json.dumps(json.loads(p.read_text())["abi"], sort_keys=True, separators=(",", ":")).encode()
            source_map[relative + "#abi"] = hashlib.sha256(encoded).hexdigest()
        else:
            source_map[relative] = sha256(p)
    return {"executionSpecId": manifest["executionSpecId"], "sources": source_map, "modules": sorted({m for m, _ in sources}), "events": events}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build(), indent=2, ensure_ascii=False) + "\n"
    current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
    if args.check:
        if current != rendered:
            print("event catalog is stale; run generate_events.py", file=sys.stderr)
            return 1
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
