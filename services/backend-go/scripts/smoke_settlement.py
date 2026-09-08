"""Cross-process candidate planning smoke; no chain, database, signer or broadcast."""
import json
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
examples = json.loads((root / "internal/settlement/testdata/typescript-golden.json").read_text())
with tempfile.TemporaryDirectory(prefix="tg-settlement-plan-") as directory:
    path = Path(directory) / "input.json"
    for example in examples:
        path.write_text(json.dumps(example["input"]))
        request = json.loads(subprocess.run([str(root / "bin/settlement-worker"), "--request", str(path)], capture_output=True, text=True, check=True).stdout)
        plan = json.loads(subprocess.run([str(root / "bin/settlement-worker"), "--plan", str(path)], capture_output=True, text=True, check=True).stdout)
        for result in (request, plan):
            assert result["candidateOnly"] and not result["onchainVerified"] and not result["priceReferenceVerified"] and not result["transactionSubmission"]
        assert request["request"]["requestDigest"] == example["plan"]["requestDigest"]
        assert request["request"]["items"] == example["plan"]["items"]
        assert plan["plan"] == example["plan"]
    rejected = subprocess.run([str(root / "bin/settlement-worker"), "--run"], capture_output=True, text=True)
    assert rejected.returncode != 0 and not rejected.stdout
print(f"PASS: {len(examples)} cross-process Go/TypeScript settlement candidates; execution unavailable")
