#!/usr/bin/env python3
"""Run checkpoint and migration tests in a disposable local PostgreSQL."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from smoke_local import free_port, run_checked
root = Path(__file__).resolve().parent.parent
commands = {n: shutil.which(n) for n in ('initdb', 'pg_ctl')}
if not all(commands.values()):
    raise SystemExit('initdb and pg_ctl are required')
with tempfile.TemporaryDirectory(prefix='tg-holder-checkpoint-', dir='/tmp') as tmp:
    data = Path(tmp)
    started = False
    try:
        run_checked([commands['initdb'], '-D', str(data/'db'), '-A', 'trust', '-U', 'tickergarden', '--no-locale', '-E', 'UTF8'])
        port = free_port()
        run_checked([commands['pg_ctl'], '-D', str(data/'db'), '-l', str(data/'postgres.log'), '-o', f'-h 127.0.0.1 -p {port} -k {data}', '-w', 'start'])
        started = True
        env = dict(os.environ, TG_TEST_HOLDER_CHECKPOINT='1', TG_TEST_DATABASE_URL=f'postgres://tickergarden@127.0.0.1:{port}/postgres?sslmode=disable')
        subprocess.run(['go', 'test', '-race', '-count=1', '-v', './internal/holderledger', '-run', 'Checkpoint'], cwd=root, env=env, check=True)
        subprocess.run(['go', 'test', '-race', '-count=1', './integration'], cwd=root, env=env, check=True)
    finally:
        if started:
            run_checked([commands['pg_ctl'], '-D', str(data/'db'), '-m', 'fast', '-w', 'stop'])
