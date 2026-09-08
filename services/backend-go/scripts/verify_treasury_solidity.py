"""Execute golden claim hashes against the actual Solidity library in an isolated build."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
repo = root.parents[1]
forge = os.environ.get("FORGE") or shutil.which("forge")
if not forge:
    raise SystemExit("forge is required for the Solidity Treasury claim-domain check")
cases = json.loads((root / "internal/treasury/testdata/golden.json").read_text())["cases"]
fields = ["chainId", "distributor", "marketId", "epochId", "memeToken", "quoteToken", "eligibilityPolicyHash", "windowStart", "windowEnd", "sourceBlockNumber", "sourceBlockHash"]
addresses = {"distributor", "memeToken", "quoteToken"}
# Numeric casts avoid Solidity checksum-literal interpretation while retaining every byte.
def value(name, v):
    return f"address(uint160({int(v, 16)}))" if name in addresses else str(v)

functions = []
for i, case in enumerate(cases):
    output = case["output"]
    context = ",".join(f"{f}: {value(f, output['context'][f])}" for f in fields)
    lines = [f"function testVector{i}() public pure {{"]
    if output["leaves"]:
        lines.append(f"TreasuryClaimLeafV1.Context memory c = TreasuryClaimLeafV1.Context({{{context}}});")
    for leaf in output["leaves"]:
        account = f"address(uint160({int(leaf['account'], 16)}))"
        lines.append(f"require(TreasuryClaimLeafV1.hash(c,{leaf['index']},{account},{leaf['twab']},{leaf['amount']}) == {leaf['leaf']}, 'claim domain mismatch');")
    if not output["leaves"]:
        lines.append(f"require(keccak256(bytes('TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1')) == {output['merkleRoot']}, 'empty root mismatch');")
    lines.append("}")
    functions.append("\n".join(lines))
with tempfile.TemporaryDirectory(prefix="tickergarden-treasury-solidity-") as tmp:
    directory = Path(tmp)
    (directory / "src").mkdir()
    (directory / "test").mkdir()
    shutil.copyfile(repo / "contracts/src/v1/libraries/TreasuryClaimLeafV1.sol", directory / "src/TreasuryClaimLeafV1.sol")
    (directory / "foundry.toml").write_text('[profile.default]\nsolc_version = "0.8.26"\nevm_version = "cancun"\n')
    (directory / "test/ClaimDomain.t.sol").write_text('// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\nimport {TreasuryClaimLeafV1} from "../src/TreasuryClaimLeafV1.sol";\ncontract ClaimDomainTest {\n' + "\n".join(functions) + "\n}\n")
    subprocess.run([forge, "test", "--root", str(directory)], check=True)
