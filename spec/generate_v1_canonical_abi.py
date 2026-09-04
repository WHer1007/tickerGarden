import argparse
import json
from pathlib import Path

from generate_v1_hash_vectors import keccak256


ROOT = Path(__file__).resolve().parent
ABI_PATH = ROOT / "v1_abi_surface.json"
PERMISSIONS_PATH = ROOT / "v1_permissions_matrix.json"
OUTPUT_PATH = ROOT / "v1_canonical_abi.json"


def split_top_level(value):
    if not value:
        return []
    parts = []
    start = 0
    depth = 0
    for index, char in enumerate(value):
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(value[start:index])
            start = index + 1
    parts.append(value[start:])
    return parts


def parse_signature(signature):
    open_index = signature.index("(")
    return signature[:open_index], signature[open_index + 1 : -1]


def type_from_field(field):
    return field.split(" ", 1)[0]


def collect_types(abi):
    definitions = dict(abi.get("typeDefinitions", {}))
    for module in abi["modules"]:
        for name, fields in module.get("structs", {}).items():
            previous = definitions.get(name)
            if previous is not None and previous != fields:
                raise ValueError(f"ambiguous type definition: {name}")
            definitions[name] = fields
        for name in module.get("enums", {}):
            previous = definitions.get(name)
            if previous is not None and previous != "uint8":
                raise ValueError(f"ambiguous enum definition: {name}")
            # Solidity enums are encoded as uint8 while the generated source
            # keeps the named enum for readability and type safety.
            definitions[name] = "uint8"
    return definitions


def expand_type(type_name, definitions, stack=()):
    array_suffix = ""
    base = type_name
    while base.endswith("]"):
        bracket = base.rfind("[")
        array_suffix = base[bracket:] + array_suffix
        base = base[:bracket]
    definition = definitions.get(base)
    if definition is None:
        return base + array_suffix
    if isinstance(definition, str):
        return expand_type(definition, definitions, stack) + array_suffix
    if base in stack:
        raise ValueError(f"recursive ABI type: {' -> '.join(stack + (base,))}")
    members = [
        expand_type(type_from_field(field), definitions, stack + (base,))
        for field in definition
    ]
    return f"({','.join(members)}){array_suffix}"


def canonical_signature(display_signature, definitions):
    name, arguments = parse_signature(display_signature)
    expanded = [expand_type(item, definitions) for item in split_top_level(arguments)]
    return f"{name}({','.join(expanded)})"


def canonical_event_signature(display_event, definitions):
    name, arguments = parse_signature(display_event)
    types = []
    for declaration in split_top_level(arguments):
        type_name = declaration.strip().split(" ", 1)[0]
        types.append(expand_type(type_name, definitions))
    return f"{name}({','.join(types)})"


def build():
    abi = json.loads(ABI_PATH.read_text(encoding="utf-8"))
    permissions = json.loads(PERMISSIONS_PATH.read_text(encoding="utf-8"))
    definitions = collect_types(abi)
    permission_rows = {
        (row["module"], row["signature"]): row for row in permissions["functions"]
    }
    mutations = []
    events = []
    for module in abi["modules"]:
        for function in module.get("functions", []):
            if function["mutability"] in {"view", "pure"}:
                continue
            key = (module["module"], function["signature"])
            permission = permission_rows.get(key)
            if permission is None:
                raise ValueError(f"missing permission row: {key}")
            if function["caller"] != permission["caller"]:
                raise ValueError(
                    f"caller mismatch for {key}: {function['caller']} != {permission['caller']}"
                )
            mutations.append(
                {
                    "module": module["module"],
                    "displaySignature": function["signature"],
                    "canonicalSignature": canonical_signature(function["signature"], definitions),
                    "selector": "0x"
                    + keccak256(
                        canonical_signature(function["signature"], definitions).encode()
                    )[:4].hex(),
                    "selectorHash": "FIRST_4_BYTES_OF_KECCAK256_CANONICAL_SIGNATURE",
                    "caller": permission["caller"],
                    "executionDelaySeconds": permission["delaySeconds"],
                    "stateDelaySeconds": permission.get("stateDelaySeconds", 0),
                    "stateDelayAnchor": permission.get("stateDelayAnchor", "NONE"),
                    "precondition": permission.get("precondition", "NONE"),
                    "recipient": permission["recipient"],
                }
            )
        for display_event in module.get("events", []):
            signature = canonical_event_signature(display_event, definitions)
            events.append(
                {
                    "module": module["module"],
                    "displayEvent": display_event,
                    "canonicalSignature": signature,
                    "topic0": "0x" + keccak256(signature.encode()).hex(),
                }
            )
    return {
        "schemaVersion": 1,
        "executionSpecId": abi["executionSpecId"],
        "sourceAbi": ABI_PATH.name,
        "sourcePermissions": PERMISSIONS_PATH.name,
        "selectorRule": "bytes4(keccak256(bytes(canonicalSignature)))",
        "eventTopicRule": "keccak256(bytes(canonicalEventSignature))",
        "mutations": mutations,
        "events": events,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if args.write:
        OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
