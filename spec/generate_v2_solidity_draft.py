import argparse
import json
from pathlib import Path

from generate_v2_canonical_abi import collect_types, parse_signature, split_top_level


ROOT = Path(__file__).resolve().parent
ABI_PATH = ROOT / "v2_abi_surface.json"
PERMISSIONS_PATH = ROOT / "v2_permissions_matrix.json"
OUTPUT_PATH = ROOT / "interfaces" / "IV2MutationSurfaceDraft.sol"


def base_type(type_name):
    while type_name.endswith("]"):
        type_name = type_name[: type_name.rfind("[")]
    return type_name


def solidity_parameter(type_name, definitions):
    base = base_type(type_name)
    if base == "BalanceDelta":
        type_name = type_name.replace("BalanceDelta", "int256", 1)
        base = "int256"
    if isinstance(definitions.get(base), list):
        return f"{type_name} calldata"
    if type_name.endswith("]") or base in {"bytes", "string"}:
        return f"{type_name} calldata"
    return type_name


def solidity_returns(returns_value):
    inner = returns_value[1:-1]
    if not inner:
        return ""
    return f" returns ({', '.join(split_top_level(inner))})"


def render():
    abi = json.loads(ABI_PATH.read_text(encoding="utf-8"))
    permissions = json.loads(PERMISSIONS_PATH.read_text(encoding="utf-8"))
    definitions = collect_types(abi)
    permission_rows = {
        (row["module"], row["signature"]): row for row in permissions["functions"]
    }
    used_structs = set()
    for module in abi["modules"]:
        for function in module.get("functions", []):
            if function["mutability"] in {"view", "pure"}:
                continue
            _, arguments = parse_signature(function["signature"])
            for type_name in split_top_level(arguments):
                if isinstance(definitions.get(base_type(type_name)), list):
                    used_structs.add(base_type(type_name))

    lines = [
        "// SPDX-License-Identifier: MIT",
        "pragma solidity 0.8.26;",
        "",
        "// GENERATED DRAFT: do not implement against this file before V2-M0 closes.",
        "// Source: v2_abi_surface.json + v2_permissions_matrix.json",
        "",
    ]
    for name in sorted(used_structs):
        lines.append(f"struct {name} {{")
        for field in definitions[name]:
            field_type, field_name = field.split(" ", 1)
            if field_type == "BalanceDelta":
                field_type = "int256"
            lines.append(f"    {field_type} {field_name};")
        lines.extend(["}", ""])

    for module in abi["modules"]:
        mutations = [
            function
            for function in module.get("functions", [])
            if function["mutability"] not in {"view", "pure"}
        ]
        if not mutations:
            continue
        lines.append(f"interface I{module['module']}MutationDraft {{")
        for function in mutations:
            key = (module["module"], function["signature"])
            permission = permission_rows[key]
            name, arguments = parse_signature(function["signature"])
            params = ", ".join(
                solidity_parameter(item, definitions)
                for item in split_top_level(arguments)
            )
            state_delay = permission.get("stateDelaySeconds", 0)
            lines.append(
                f"    // caller={permission['caller']}; executionDelay={permission['delaySeconds']}; stateDelay={state_delay}"
            )
            payable = " payable" if function["mutability"] == "payable" else ""
            returns_clause = solidity_returns(function["returns"])
            lines.append(
                f"    function {name}({params}) external{payable}{returns_clause};"
            )
        lines.extend(["}", ""])
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    rendered = render()
    if args.write:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
