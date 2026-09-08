"""Content binary restart and immutable retrieval against the isolated smoke DB."""
import json
import hashlib
import base64
import tempfile
from pathlib import Path
import os
import signal
import subprocess
import time
import urllib.request
import urllib.error


def run(root, database_url, port, expected=None):
    origin = f"http://127.0.0.1:{port}"
    env = dict(os.environ, TG_CONTENT_DATABASE_URL=database_url,
               TG_CONTENT_HTTP_ADDR=f"127.0.0.1:{port}",
               TG_CONTENT_PUBLIC_ORIGIN=origin, TG_CONTENT_WEB_ORIGIN="http://localhost:5173")
    uri, payload = expected if expected is not None else (None, None)
    for iteration in range(2):
        process = subprocess.Popen([str(root / "bin/content-worker"), "--run"], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(50):
                try:
                    with urllib.request.urlopen(origin + "/readyz", timeout=2) as response:
                        if response.status == 200:
                            break
                except (urllib.error.URLError, ConnectionError):
                    pass
                if process.poll() is not None:
                    raise RuntimeError("content worker exited before readiness")
                time.sleep(0.1)
            else:
                raise RuntimeError("content worker never ready")
            if iteration == 0 and expected is None:
                request = urllib.request.Request(origin + "/launch-metadata",
                    data=json.dumps({"name": "Smoke", "symbol": "SMOKE", "image": "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQlFKUp/+BiOh/AAA="}).encode(),
                    headers={"Origin": "http://localhost:5173", "Content-Type": "application/json"})
                with urllib.request.urlopen(request, timeout=3) as response:
                    if response.status != 201:
                        raise RuntimeError("content upload failed")
                    uri = json.load(response)["metadataURI"]
            with urllib.request.urlopen(uri, timeout=3) as response:
                body = response.read()
                if payload is not None and body != payload:
                    raise RuntimeError("content changed after process restart")
                payload = body
            image_uri = json.loads(payload)["image"]
            with urllib.request.urlopen(image_uri, timeout=3) as response:
                image_bytes = response.read()
                if image_bytes != base64.b64decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQlFKUp/+BiOh/AAA="):
                    raise RuntimeError("media bytes changed after restart or restore")
            if iteration == 0 and expected is None:
                # Exercise legacy byte-preserving import through fresh CLI processes.
                legacy = (json.dumps(json.loads(payload), indent=2) + "\n").encode()
                legacy_key = hashlib.sha256(legacy).hexdigest() + ".json"
                with tempfile.TemporaryDirectory(prefix="tg-content-import-") as directory:
                    Path(directory, legacy_key).write_bytes(legacy)
                    Path(directory, image_uri.rsplit("/", 1)[1]).write_bytes(image_bytes)
                    command = [str(root / "bin/content-import"), "--directory", directory, "--origin", origin]
                    preview = subprocess.run(command, env=env, capture_output=True, text=True, check=True)
                    digest = json.loads(preview.stdout)["digest"]
                    for _ in range(2):
                        applied = subprocess.run(command + ["--apply-digest", digest],
                            env=dict(env, TG_CONTENT_IMPORT_DATABASE_URL=database_url),
                            capture_output=True, text=True, check=True)
                        if json.loads(applied.stdout)["status"] != "committed":
                            raise RuntimeError("import CLI did not commit")
                uri = origin + "/launch-metadata/" + legacy_key
                with urllib.request.urlopen(uri, timeout=3) as response:
                    if response.read() != legacy:
                        raise RuntimeError("import CLI rewrote legacy bytes")
                payload = legacy
            process.send_signal(signal.SIGTERM)
            out, err = process.communicate(timeout=12)
            if process.returncode != 0 or database_url in out + err:
                raise RuntimeError("content shutdown or log redaction failed")
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=3)
    print("Content smoke: media/metadata, legacy import, immutable retrieval, process restart and SIGTERM passed", flush=True)
    return uri, payload
