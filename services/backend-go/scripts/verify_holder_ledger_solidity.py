"""Execute Solidity and compare its observed state to the independent Go model.

Local Forge EVM only. No RPC, private key, database or broadcast is needed.
"""
import os
import pathlib
import shutil
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
repo = root.parents[1]
forge = os.environ.get("FORGE") or shutil.which("forge")
if not forge:
    raise SystemExit("FORGE must name the local Foundry executable")
with tempfile.TemporaryDirectory(prefix="tg-holder-solidity-") as directory:
    log = pathlib.Path(directory) / "solidity.log"
    result = subprocess.run(
        [forge, "test", "--match-contract", "^HolderLedgerConformance$", "--match-test", "test_exportHolderLedgerConformance", "-vv"],
        cwd=repo / "contracts", text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=300,
    )
    log.write_text(result.stdout)
    if result.returncode != 0:
        print(result.stdout)
        raise SystemExit(result.returncode)
    subprocess.run(
        ["go", "test", "-race", "-count=1", "./internal/holderledger", "-run", "^TestSolidityConformance$", "-v"],
        cwd=root, env=dict(os.environ, TG_HOLDER_SOLIDITY_LOG=str(log)), check=True, timeout=120,
    )
