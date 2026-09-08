"""Local Anvil integration, invoked by smoke_local.py with TG_SMOKE_CHAIN=1."""
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time
import urllib.request
import smoke_bindings


def run(root, data, dsn):
    anvil = os.environ.get("ANVIL") or shutil.which("anvil")
    psql = shutil.which("psql")
    if not anvil or not psql:
        raise RuntimeError("smoke-chain requires Anvil (PATH or ANVIL) and psql")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    endpoint = f"http://127.0.0.1:{port}"
    # Only an ephemeral loopback node receives test transactions. No external RPC.
    with (data / "anvil.log").open("w") as log:
        node = subprocess.Popen([anvil, "--host", "127.0.0.1", "--port", str(port),
                                 "--chain-id", "46630", "--silent"], stdout=log, stderr=log)
        try:
            def rpc(method, params):
                body = json.dumps(dict(jsonrpc="2.0", id=1, method=method, params=params)).encode()
                req = urllib.request.Request(endpoint, data=body, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=3) as response:
                    result = json.load(response)
                if "error" in result:
                    raise RuntimeError(f"local Anvil method failed: {method}")
                return result["result"]

            for _ in range(50):
                try:
                    assert rpc("eth_chainId", []) == hex(46630)
                    break
                except (OSError, AssertionError):
                    if node.poll() is not None:
                        raise RuntimeError("local Anvil exited")
                    time.sleep(0.1)
            else:
                raise RuntimeError("local Anvil did not start")
            env = dict(os.environ, TG_ENV="test", TG_CHAIN_ID="46630", TG_RPC_URL=endpoint,
                       TG_INDEXER_DATABASE_URL=dsn, TG_INDEXER_START_BLOCK="0")

            def once(action, logs):
                result = subprocess.run([str(root / "bin/indexer"), "--once"], env=env,
                                        capture_output=True, text=True, check=True)
                body = json.loads(result.stdout)
                assert body["action"] == action and body["logs"] == logs, body

            once("indexed", 0)
            # Constructor bytecode emits LOG0; the indexer never sends this transaction.
            account = rpc("eth_accounts", [])[0]
            tx = rpc("eth_sendTransaction", [dict(**{"from": account}, data="0x60006000a000", gas="0x186a0")])
            for _ in range(50):
                receipt = rpc("eth_getTransactionReceipt", [tx])
                if receipt is not None:
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError("local test transaction did not receive a receipt")
            assert receipt["status"] == "0x1" and len(receipt["logs"]) == 1
            once("indexed", 1)
            once("idle", 0)
            sql = "SELECT count(*) FROM tickergarden.chain_logs l JOIN tickergarden.chain_blocks b ON b.chain_id=l.chain_id AND b.hash=l.block_hash WHERE b.canonical"
            result = subprocess.run([psql, dsn, "-At", "-c", sql], capture_output=True, text=True, check=True)
            assert result.stdout.strip() == "1", result.stdout
            result = subprocess.run([psql, dsn, "-At", "-c", "SELECT count(*) FROM tickergarden.chain_receipts r JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash WHERE b.canonical AND b.receipts_verified AND r.status='0x1'"], capture_output=True, text=True, check=True)
            assert result.stdout.strip() == "1", "verified transaction receipt was not persisted"
            worker = subprocess.Popen([str(root / "bin/indexer"), "--run"], env=env,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                time.sleep(0.3)
                worker.send_signal(signal.SIGTERM)
                output, errors = worker.communicate(timeout=5)
                assert worker.returncode == 0 and dsn not in output + errors
            finally:
                if worker.poll() is None:
                    worker.kill()
                    worker.wait()
            # Advance only the local chain until the emitted log is finalized.
            for _ in range(4):
                finalized = rpc("eth_getBlockByNumber", ["finalized", False])
                if int(finalized["number"], 16) >= 1:
                    break
                rpc("anvil_mine", ["0x20"])
            else:
                raise RuntimeError("local Anvil did not finalize the test transaction")
            tip = int(rpc("eth_blockNumber", []), 16)
            for _ in range(2, tip + 1):
                once("indexed", 0)
            # Synthetic business values are a test fixture, not an event projector.
            snapshot = json.loads((root / "internal/readmodel/testdata/snapshot.json").read_text())
            header = rpc("eth_getBlockByNumber", ["0x1", False])
            number = str(int(finalized["number"], 16))
            sync = snapshot["sync"]
            sync.update(blockNumber=number, blockHash=finalized["hash"], headBlockNumber=number,
                        headBlockHash=finalized["hash"], revision=number + ":" + finalized["hash"])
            for item in snapshot["markets"] + snapshot["configs"] + snapshot["positions"]:
                item["source"].update(blockHash=header["hash"], transactionHash=tx)
            file = data / "verified-fixture.json"
            file.write_text(json.dumps(snapshot))
            published_env = dict(env, TG_PUBLISHER_DATABASE_URL=dsn)
            at = datetime.now(timezone.utc).isoformat()
            for _ in range(2):
                subprocess.run([str(root / "bin/publish-snapshot"), str(file), at], env=published_env,
                               capture_output=True, text=True, check=True)
            # Test runtime authentication on a second local-only deployment.
            deployed = rpc("eth_sendTransaction", [dict(**{"from": account}, data="0x6001600c60003960016000f300", gas="0x186a0")])
            for _ in range(50):
                deployed_receipt = rpc("eth_getTransactionReceipt", [deployed])
                if deployed_receipt is not None:
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError("local identity fixture deployment timed out")
            target = deployed_receipt["contractAddress"]
            deployment_height = int(deployed_receipt["blockNumber"], 16)
            for _ in range(4):
                anchor = rpc("eth_getBlockByNumber", ["finalized", False])
                if int(anchor["number"], 16) >= deployment_height:
                    break
                rpc("anvil_mine", ["0x20"])
            else:
                raise RuntimeError("identity fixture did not finalize")
            manifest = dict(executionSpecId="V1-EXEC-11", chainId=46630,
                            genesisHash=rpc("eth_getBlockByNumber", ["0x0", False])["hash"],
                            contracts=[dict(module="TickerMemeTokenV1", address=target, runtimeCodeHash=rpc("web3_sha3", ["0x00"]))])
            manifest_file = data / "runtime-identities.json"
            manifest_file.write_text(json.dumps(manifest))
            result = subprocess.run([str(root / "bin/verify-deployment"), str(manifest_file)], env=env,
                                    capture_output=True, text=True, check=True)
            assert json.loads(result.stdout)["status"] == "runtime_identities_verified"
            manifest["contracts"][0]["runtimeCodeHash"] = "0x" + "0" * 64
            manifest_file.write_text(json.dumps(manifest))
            result = subprocess.run([str(root / "bin/verify-deployment"), str(manifest_file)], env=env,
                                    capture_output=True, text=True)
            assert result.returncode != 0
            smoke_bindings.run(root, data, env, rpc)
            # Extended discovery/projection checks may outlive snapshot freshness.
            # Publish a new synthetic revision after refreshing the journal; do
            # not renew an old revision or weaken production freshness checks.
            # The automatic submitter may have mined additional synthetic
            # maintenance blocks. Ingest them before requiring an idle journal.
            for _ in range(1000):
                result = subprocess.run([str(root / "bin/indexer"), "--once"], env=env,
                                        capture_output=True, text=True, check=True)
                progress = json.loads(result.stdout)
                assert progress["action"] in ("indexed", "idle") and progress["logs"] == 0, progress
                if progress["action"] == "idle":
                    break
            else:
                raise AssertionError("journal did not drain after maintenance submission")
            final_api = rpc("eth_getBlockByNumber", ["finalized", False])
            api_number = str(int(final_api["number"], 16))
            snapshot["sync"].update(blockNumber=api_number, blockHash=final_api["hash"],
                                    headBlockNumber=api_number, headBlockHash=final_api["hash"],
                                    revision=api_number + ":" + final_api["hash"])
            file.write_text(json.dumps(snapshot))
            subprocess.run([str(root / "bin/publish-snapshot"), str(file), datetime.now(timezone.utc).isoformat()],
                           env=published_env, capture_output=True, text=True, check=True)
            print("Anvil + PostgreSQL: journal, publisher, hash-pinned runtime verification and SIGTERM passed", flush=True)
        except Exception:
            print(f"Anvil process status at failure: {node.poll()}", flush=True)
            log.flush()
            print((data / "anvil.log").read_text()[-4000:], flush=True)
            raise
        finally:
            node.terminate()
            try:
                node.wait(timeout=5)
            except subprocess.TimeoutExpired:
                node.kill()
                node.wait()
