import argparse
import json
from pathlib import Path

from generate_v2_canonical_abi import (
    canonical_event_signature,
    canonical_signature,
    collect_types,
    expand_type,
    parse_signature,
    split_top_level,
    type_from_field,
)
from generate_v2_hash_vectors import keccak256


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
ABI_PATH = ROOT / "v2_abi_surface.json"
PERMISSIONS_PATH = ROOT / "v2_permissions_matrix.json"
CANONICAL_PATH = ROOT / "v2_canonical_abi.json"
ARTIFACT_ROOT = PROJECT_ROOT / "contracts" / "out-v2" / "IV2Protocol.sol"
OUTPUT_PATH = ROOT / "v2_compiled_interface_manifest.json"


def canonical_abi_type(item):
    abi_type = item["type"]
    if abi_type.startswith("tuple"):
        suffix = abi_type[len("tuple") :]
        return f"({','.join(canonical_abi_type(component) for component in item['components'])}){suffix}"
    return abi_type


def function_signature(item):
    return f"{item['name']}({','.join(canonical_abi_type(value) for value in item['inputs'])})"


def event_signature(item):
    return function_signature(item)


def output_signature(item):
    return f"({','.join(canonical_abi_type(value) for value in item['outputs'])})"


def validate_parameter(item, expected_type, definitions, expected_name):
    expected_canonical_type = expand_type(expected_type, definitions)
    if canonical_abi_type(item) != expected_canonical_type:
        raise ValueError(f"ABI type drift for {expected_name}")
    if item["name"] != expected_name:
        raise ValueError(f"ABI name drift: expected={expected_name} compiled={item['name']}")
    base = expected_type
    suffix = ""
    while base.endswith("]"):
        bracket = base.rfind("[")
        suffix = base[bracket:] + suffix
        base = base[:bracket]
    fields = definitions.get(base)
    expected_internal_type = (
        f"struct {base}{suffix}"
        if isinstance(fields, list)
        else expand_type(expected_type, definitions)
    )
    if item["internalType"] != expected_internal_type:
        raise ValueError(
            f"ABI internalType drift for {expected_name}: "
            f"expected={expected_internal_type} compiled={item['internalType']}"
        )
    if isinstance(fields, list):
        components = item.get("components", [])
        if len(components) != len(fields):
            raise ValueError(f"ABI tuple arity drift for {expected_name}")
        for component, field in zip(components, fields):
            field_type, field_name = field.split(" ", 1)
            validate_parameter(component, field_type, definitions, field_name)


def artifact(name):
    path = ARTIFACT_ROOT / f"{name}.json"
    if not path.exists():
        raise ValueError(f"missing compiled interface artifact: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def build():
    surface = json.loads(ABI_PATH.read_text(encoding="utf-8"))
    permissions = json.loads(PERMISSIONS_PATH.read_text(encoding="utf-8"))
    canonical = json.loads(CANONICAL_PATH.read_text(encoding="utf-8"))
    definitions = collect_types(surface)
    permission_rows = {
        (row["module"], row["signature"]): row
        for row in permissions["functions"]
        if row["module"] != "AccessManager"
    }
    canonical_rows = {
        (row["module"], row["displaySignature"]): row
        for row in canonical["mutations"]
    }
    modules = []
    mutations = []
    events = []
    compiler_version = None
    interface_source_hash = None

    for module in surface["modules"]:
        module_name = module["module"]
        compiled_artifact = artifact(f"I{module_name}")
        compiled_abi = compiled_artifact["abi"]
        current_compiler = compiled_artifact["metadata"]["compiler"]["version"]
        current_source_hash = compiled_artifact["metadata"]["sources"][
            "src/v2/interfaces/IV2Protocol.sol"
        ]["keccak256"]
        compiler_version = compiler_version or current_compiler
        interface_source_hash = interface_source_hash or current_source_hash
        if compiler_version != current_compiler or interface_source_hash != current_source_hash:
            raise ValueError("interface artifacts were not produced by one compiler/source")
        compiled_functions = {
            function_signature(item): item for item in compiled_abi if item["type"] == "function"
        }
        expected_functions = {
            canonical_signature(item["signature"], definitions): item
            for item in module.get("functions", [])
        }
        if set(compiled_functions) != set(expected_functions):
            raise ValueError(
                f"{module_name} function drift: expected={sorted(expected_functions)} compiled={sorted(compiled_functions)}"
            )

        compiled_events = {
            event_signature(item): item for item in compiled_abi if item["type"] == "event"
        }
        expected_events = {
            canonical_event_signature(item, definitions): item for item in module.get("events", [])
        }
        if set(compiled_events) != set(expected_events):
            raise ValueError(
                f"{module_name} event drift: expected={sorted(expected_events)} compiled={sorted(compiled_events)}"
            )

        for signature, expected in expected_functions.items():
            compiled = compiled_functions[signature]
            _, expected_arguments = parse_signature(expected["signature"])
            expected_input_types = split_top_level(expected_arguments)
            for index, (compiled_input, expected_type) in enumerate(
                zip(compiled["inputs"], expected_input_types)
            ):
                validate_parameter(compiled_input, expected_type, definitions, f"arg{index}")
            if compiled["stateMutability"] != expected["mutability"]:
                raise ValueError(f"{module_name}.{signature} mutability drift")
            expected_returns = canonical_signature(
                f"returns{expected['returns']}", definitions
            )[len("returns") :]
            if output_signature(compiled) != expected_returns:
                raise ValueError(f"{module_name}.{signature} return drift")
            for index, (compiled_output, expected_type) in enumerate(
                zip(compiled["outputs"], split_top_level(expected["returns"][1:-1]))
            ):
                validate_parameter(compiled_output, expected_type, definitions, f"output{index}")
            if expected["mutability"] not in {"view", "pure"}:
                display_key = (module_name, expected["signature"])
                permission = permission_rows.pop(display_key, None)
                if permission is None:
                    raise ValueError(f"missing permission row: {display_key}")
                canonical_row = canonical_rows[display_key]
                selector = "0x" + keccak256(signature.encode())[:4].hex()
                if selector != canonical_row["selector"]:
                    raise ValueError(f"{module_name}.{signature} selector drift")
                if compiled_artifact["methodIdentifiers"].get(signature) != selector[2:]:
                    raise ValueError(f"{module_name}.{signature} artifact selector drift")
                mutation = {
                    "target": module_name,
                    "displaySignature": expected["signature"],
                    "canonicalSignature": signature,
                    "selector": selector,
                    "caller": permission["caller"],
                    "executionDelaySeconds": permission["delaySeconds"],
                    "stateDelaySeconds": permission.get("stateDelaySeconds", 0),
                    "stateDelayAnchor": permission.get("stateDelayAnchor", "NONE"),
                    "precondition": permission.get("precondition", "NONE"),
                    "recipient": permission["recipient"],
                }
                for key in (
                    "displaySignature",
                    "canonicalSignature",
                    "selector",
                    "caller",
                    "executionDelaySeconds",
                    "stateDelaySeconds",
                    "stateDelayAnchor",
                    "precondition",
                    "recipient",
                ):
                    canonical_value = canonical_row.get(key, "NONE")
                    if mutation[key] != canonical_value:
                        raise ValueError(f"{module_name}.{signature} {key} drift")
                mutations.append(mutation)

        for signature, expected_display in expected_events.items():
            compiled = compiled_events[signature]
            _, expected_arguments = parse_signature(expected_display)
            declarations = split_top_level(expected_arguments)
            expected_indexed = ["indexed" in part.split() for part in declarations]
            actual_indexed = [item["indexed"] for item in compiled["inputs"]]
            if actual_indexed != expected_indexed:
                raise ValueError(f"{module_name}.{signature} indexed-field drift")
            for index, (compiled_input, declaration) in enumerate(
                zip(compiled["inputs"], declarations)
            ):
                pieces = declaration.split()
                validate_parameter(compiled_input, pieces[0], definitions, pieces[-1] if len(pieces) > 1 else f"arg{index}")
            topic0 = "0x" + keccak256(signature.encode()).hex()
            canonical_event = next(
                row
                for row in canonical["events"]
                if row["module"] == module_name and row["canonicalSignature"] == signature
            )
            if canonical_event["topic0"] != topic0:
                raise ValueError(f"{module_name}.{signature} topic drift")
            events.append({"target": module_name, "canonicalSignature": signature, "topic0": topic0})

        modules.append(
            {
                "target": module_name,
                "artifact": f"contracts/out-v2/IV2Protocol.sol/I{module_name}.json",
                "functionCount": len(compiled_functions),
                "eventCount": len(compiled_events),
            }
        )

    if permission_rows:
        raise ValueError(f"permission rows without compiled mutations: {sorted(permission_rows)}")

    compiled_errors = {
        function_signature(item)
        for item in artifact("IV2Errors")["abi"]
        if item["type"] == "error"
    }
    expected_errors = {
        canonical_signature(item, definitions) for item in surface["requiredErrors"]
    }
    if compiled_errors != expected_errors:
        raise ValueError(
            f"required error drift: expected={sorted(expected_errors)} compiled={sorted(compiled_errors)}"
        )

    return {
        "schemaVersion": 1,
        "executionSpecId": surface["executionSpecId"],
        "source": "COMPILED_SOLC_0_8_26_INTERFACE_ARTIFACTS",
        "compilerVersion": compiler_version,
        "interfaceSourceKeccak256": interface_source_hash,
        "compiledSourceTypes": {
            "aliases": {
                name: value
                for name, value in surface.get("typeDefinitions", {}).items()
                if isinstance(value, str)
            },
            "structs": {
                **{
                    name: value
                    for name, value in surface.get("typeDefinitions", {}).items()
                    if isinstance(value, list)
                },
                **{
                    name: fields
                    for module in surface["modules"]
                    for name, fields in module.get("structs", {}).items()
                },
            },
            "enums": {
                name: values
                for module in surface["modules"]
                for name, values in module.get("enums", {}).items()
            },
        },
        "modules": modules,
        "requiredErrors": sorted(compiled_errors),
        "mutations": mutations,
        "events": events,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.write and args.check:
        parser.error("--write and --check are mutually exclusive")
    rendered = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if args.write:
        OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    elif args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"compiled interface manifest is stale: {OUTPUT_PATH}")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
