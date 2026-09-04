import argparse
import json
from pathlib import Path

from generate_v1_canonical_abi import collect_types, parse_signature, split_top_level


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
ABI_PATH = ROOT / "v1_abi_surface.json"
OUTPUT_PATH = PROJECT_ROOT / "contracts" / "src" / "v1" / "interfaces" / "IV1Protocol.sol"


def base_type(type_name):
    while type_name.endswith("]"):
        type_name = type_name[: type_name.rfind("[")]
    return type_name


def replace_alias(type_name, definitions):
    suffix = ""
    base = type_name
    while base.endswith("]"):
        bracket = base.rfind("[")
        suffix = base[bracket:] + suffix
        base = base[:bracket]
    target = definitions.get(base)
    if isinstance(target, str):
        return replace_alias(target, definitions) + suffix
    return base + suffix


def needs_data_location(type_name, definitions):
    resolved = replace_alias(type_name, definitions)
    return (
        resolved.endswith("]")
        or base_type(resolved) in {"bytes", "string"}
        or isinstance(definitions.get(base_type(type_name)), list)
    )


def parameter(type_name, name, definitions, location):
    rendered_type = replace_alias(type_name, definitions)
    if needs_data_location(type_name, definitions):
        return f"{rendered_type} {location} {name}"
    return f"{rendered_type} {name}"


def render_parameters(signature, definitions, location):
    _, arguments = parse_signature(signature)
    return ", ".join(
        parameter(type_name, f"arg{index}", definitions, location)
        for index, type_name in enumerate(split_top_level(arguments))
    )


def render_returns(returns_value, definitions):
    return_types = split_top_level(returns_value[1:-1])
    if not return_types:
        return ""
    rendered = ", ".join(
        parameter(type_name, f"output{index}", definitions, "memory")
        for index, type_name in enumerate(return_types)
    )
    return f" returns ({rendered})"


def render_event(display_event, definitions):
    name, arguments = parse_signature(display_event)
    rendered = []
    for index, declaration in enumerate(split_top_level(arguments)):
        pieces = declaration.strip().split()
        type_name = replace_alias(pieces[0], definitions)
        indexed = " indexed" if "indexed" in pieces[1:-1] else ""
        parameter_name = pieces[-1] if len(pieces) > 1 else f"arg{index}"
        rendered.append(f"{type_name}{indexed} {parameter_name}")
    return f"event {name}({', '.join(rendered)});"


def render_error(display_error, definitions):
    name, _ = parse_signature(display_error)
    return f"    error {name}({render_parameters(display_error, definitions, 'memory')});"


def render():
    abi = json.loads(ABI_PATH.read_text(encoding="utf-8"))
    structs = {
        name: fields
        for module in abi["modules"]
        for name, fields in module.get("structs", {}).items()
    }
    enums = {
        name: values
        for module in abi["modules"]
        for name, values in module.get("enums", {}).items()
    }
    definitions = {
        name: value for name, value in collect_types(abi).items()
        if name not in enums
    }

    lines = [
        "// SPDX-License-Identifier: MIT",
        "pragma solidity 0.8.26;",
        "",
        "// GENERATED FILE. DO NOT EDIT.",
        f"// Source: spec/v1_abi_surface.json ({abi['executionSpecId']})",
        "// forge-lint: disable-start(multi-contract-file)",
        "// forgefmt: disable-start",
        "",
    ]

    for name, fields in {**{k: v for k, v in abi.get("typeDefinitions", {}).items() if isinstance(v, list)}, **structs}.items():
        lines.append(f"struct {name} {{")
        for field in fields:
            field_type, field_name = field.split(" ", 1)
            lines.append(f"    {replace_alias(field_type, definitions)} {field_name};")
        lines.extend(["}", ""])

    for name, values in enums.items():
        lines.append(f"enum {name} {{")
        lines.append("    " + ",\n    ".join(values))
        lines.extend(["}", ""])

    lines.append("interface IV1Errors {")
    lines.extend(render_error(item, definitions) for item in abi["requiredErrors"])
    lines.extend(["}", ""])

    for module in abi["modules"]:
        lines.append(f"interface I{module['module']} {{")
        for display_event in module.get("events", []):
            lines.append(f"    {render_event(display_event, definitions)}")
        if module.get("events") and module.get("functions"):
            lines.append("")
        for function in module.get("functions", []):
            name, _ = parse_signature(function["signature"])
            params = render_parameters(function["signature"], definitions, "calldata")
            mutability = function["mutability"]
            modifier = "" if mutability == "nonpayable" else f" {mutability}"
            returns_clause = render_returns(function["returns"], definitions)
            lines.append(
                f"    function {name}({params}) external{modifier}{returns_clause};"
            )
        lines.extend(["}", ""])

    lines.extend(
        [
            "// forgefmt: disable-end",
            "// forge-lint: disable-end(multi-contract-file)",
            "",
        ]
    )
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.write and args.check:
        parser.error("--write and --check are mutually exclusive")
    rendered = render()
    if args.write:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    elif args.check:
        if not OUTPUT_PATH.exists() or OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"generated interface is stale: {OUTPUT_PATH}")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
