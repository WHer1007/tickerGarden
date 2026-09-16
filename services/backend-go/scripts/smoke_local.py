#!/usr/bin/env python3
"""Exercise built binaries against an isolated, temporary local PostgreSQL server."""

import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def run_checked(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed: {result.stderr.strip()}")
    return result.stdout


def main():
    root = Path(__file__).resolve().parent.parent
    commands = {name: shutil.which(name) for name in ("initdb", "pg_ctl", "createdb", "pg_dump", "pg_restore")}
    if not all(commands.values()):
        raise SystemExit("Local smoke needs initdb, pg_ctl and createdb on PATH (PostgreSQL 14+).")
    if not (root / "bin/api").exists() or not (root / "bin/migrate").exists():
        raise SystemExit("Run make build first.")
    # Use /tmp to stay within macOS's Unix socket pathname limit.
    data = Path(tempfile.mkdtemp(prefix="tg-go-pg-", dir="/tmp"))
    started = False
    api = None
    try:
        run_checked([commands["initdb"], "-D", str(data / "db"), "-A", "trust",
                     "-U", "tickergarden", "--no-locale", "-E", "UTF8"])
        port = free_port()
        run_checked([commands["pg_ctl"], "-D", str(data / "db"), "-l", str(data / "postgres.log"),
                     "-o", f"-h 127.0.0.1 -p {port} -k {data}", "-w", "start"])
        started = True
        test_url = f"postgres://tickergarden@127.0.0.1:{port}/postgres?sslmode=disable"
        subprocess.run([os.environ.get("GO", "go"), "test", "-race", "-count=1", "-v", "./integration"],
                       cwd=root, env=dict(os.environ, TG_TEST_DATABASE_URL=test_url), check=True)
        run_checked([commands["createdb"], "-h", "127.0.0.1", "-p", str(port), "-U", "tickergarden", "scaffold_cli"])
        cli_url = f"postgres://tickergarden@127.0.0.1:{port}/scaffold_cli?sslmode=disable"
        migration_env = dict(os.environ, TG_MIGRATION_DATABASE_URL=cli_url)
        migration_count = len(list((root / "migrations").glob("[0-9]*.sql")))
        for action, expected in (("up", migration_count), ("up", 0), ("status", None)):
            body = json.loads(run_checked([str(root / "bin/migrate"), action], cwd=data, env=migration_env))
            if expected is not None and body.get("migrations") != expected:
                raise RuntimeError("Migration CLI was not idempotent across process restarts")
        print("Migration CLI: initial up, fresh-process up and embedded status passed", flush=True)
        import smoke_content
        content_port = free_port()
        content_expected = smoke_content.run(root, cli_url, content_port)
        dump = data / "content-backup.dump"
        run_checked([commands["pg_dump"], "--format=custom", "--no-owner", "--no-acl", "--file", str(dump), cli_url])
        run_checked([commands["createdb"], "-h", "127.0.0.1", "-p", str(port), "-U", "tickergarden", "scaffold_restored"])
        restored_url = f"postgres://tickergarden@127.0.0.1:{port}/scaffold_restored?sslmode=disable"
        run_checked([commands["pg_restore"], "--exit-on-error", "--no-owner", "--no-acl", "--dbname", restored_url, str(dump)])
        smoke_content.run(root, restored_url, content_port, expected=content_expected)
        print("Content backup: pg_dump/pg_restore into a new database; original URI and bytes verified", flush=True)
        if os.environ.get("TG_SMOKE_CHAIN") == "1":
            import smoke_chain
            smoke_chain.run(root, data, cli_url)
        for configured in (False, True):
            api_port = free_port()
            env = dict(os.environ, TG_HTTP_ADDR=f"127.0.0.1:{api_port}", TG_ENV="test",
                       TG_CHAIN_ID="46630", TG_DATABASE_URL=cli_url if configured else "",
                       TG_WEB_ORIGIN="http://localhost:5193", TG_SHUTDOWN_TIMEOUT="10s", TG_PROBE_TIMEOUT="2s")
            api = subprocess.Popen([str(root / "bin/api")], env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)

            def get(path):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{api_port}" + path, timeout=2) as response:
                        return response.status, json.load(response)
                except urllib.error.HTTPError as error:
                    return error.code, json.load(error)

            for _ in range(50):
                try:
                    status, _ = get("/livez")
                    if status == 200:
                        break
                except (urllib.error.URLError, ConnectionError):
                    pass
                if api.poll() is not None:
                    raise RuntimeError("API exited before becoming live")
                time.sleep(0.1)
            else:
                raise RuntimeError("API did not become live")
            published = configured and os.environ.get("TG_SMOKE_CHAIN") == "1"
            expected_sync = "synced" if published else "unavailable"
            status, health = get("/health")
            if status != 200 or health["readApiImplemented"] is not True or health["sync"]["status"] != expected_sync:
                raise RuntimeError(f"Health mismatch: HTTP={status}, readApiImplemented={health.get('readApiImplemented')}, sync={health.get('sync', {}).get('status')}, expected={expected_sync}")
            status, ready = get("/readyz")
            expected = "reachable" if configured else "not_configured"
            if status != (200 if published else 503) or ready["checks"]["database"] != expected:
                raise RuntimeError("Scaffold readiness is incorrect")
            if get("/v1/markets")[0] != 200:
                raise RuntimeError("Unavailable markets endpoint did not return an empty page")
            if published and len(get("/v1/markets")[1]["items"]) != 2:
                raise RuntimeError("published market fixture was not served by Go API")
            api.send_signal(signal.SIGTERM)
            logs, errors = api.communicate(timeout=12)
            if api.returncode != 0 or cli_url in logs + errors:
                raise RuntimeError("API shutdown or log redaction failed")
            api = None
            print(f"API smoke: database={expected}, readiness={200 if published else 503}, SIGTERM=clean", flush=True)
        print("PASS: isolated PostgreSQL, migrations, HTTP and shutdown")
    finally:
        if api is not None:
            api.terminate()
            try:
                api.wait(timeout=3)
            except subprocess.TimeoutExpired:
                api.kill()
                api.wait()
        if started:
            stopped = subprocess.run([commands["pg_ctl"], "-D", str(data / "db"), "-m", "fast", "-w", "stop"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if stopped.returncode:
                raise RuntimeError(f"Could not stop test PostgreSQL; preserved data at {data}")
        shutil.rmtree(data)


if __name__ == "__main__":
    main()
