#!/usr/bin/env python3
"""Render private service projections from the single host configuration.

Run as root on the server. --check validates without modifying files or services.
This never starts workers, dispatches jobs, or contacts an RPC endpoint.
"""
import argparse
import json
import os
import pathlib
import pwd
import re
import tempfile
from urllib.parse import urlsplit

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--config', default='/etc/tickergarden/hosting.json')
p.add_argument('--root', required=True)
p.add_argument('--check', action='store_true')
a = p.parse_args()
root = pathlib.Path(a.root).resolve()
config = json.loads(pathlib.Path(a.config).read_text())
services = config['services']
ports = set()
routes = None
for name, c in services.items():
    assert re.fullmatch(r'[a-z][a-z0-9-]+', name) and c['name'] == name, 'Invalid service name'
    assert c['kind'] in ['read-api', 'pipeline', 'content', 'gateway', 'web'], 'Invalid service kind'
    assert c['environment'] in ['production', 'test'], 'Invalid environment'
    assert c['host'] == '172.18.0.1', 'Services must bind the Docker private gateway'
    assert isinstance(c['port'], int) and 8201 <= c['port'] <= 8311 and c['port'] not in ports, 'Invalid or duplicate port'
    ports.add(c['port'])
    source = pathlib.Path(c['source']).resolve()
    assert source.is_relative_to(root / 'sources') and source.is_dir(), 'Source must be in this release'
    assert all(isinstance(k, str) and isinstance(v, str) for k, v in c['env'].items()), 'Environment values must be strings'
    assert not c.get('scheduler') or c['kind'] in ['content', 'pipeline'], 'Invalid scheduler role'
    assert not c.get('priceSchedule') or name in ['rh-pipeline', 'test-pipeline'], 'Invalid price scheduler role'
    if routes is None:
        routes = c['transport']
        for origin, target in routes.items():
            public, private = urlsplit(origin), urlsplit(target)
            assert public.scheme == 'https' and not public.username and not public.password and not public.query and not public.fragment, 'Invalid public origin'
            assert private.scheme == 'http' and re.fullmatch(r'172\.18\.0\.\d+', private.hostname or '') and not private.username and not private.password and not private.query and not private.fragment, 'Invalid private target'
    assert routes == c['transport'], 'Private transport projections disagree'
    overrides = c.get('transportOverrides', {})
    assert not overrides or c['kind'] == 'web', 'Only Web may override shared upstream routing'
    for origin, target in overrides.items():
        public, private = urlsplit(origin), urlsplit(target)
        assert public.scheme == 'https' and not public.username and not public.password and not public.query and not public.fragment, 'Invalid override origin'
        assert private.scheme == 'http' and private.hostname == '172.18.0.1' and private.port in [8300, 8310] and private.path in ['', '/'] and not private.username and not private.password and not private.query and not private.fragment, 'Override must route through an isolated gateway'
        assert private.port == (8310 if c['environment'] == 'test' else 8300), 'Cross-environment gateway override'
    if c.get('bsc'):
        profile = c['bscProfile']
        assert profile['chainId'] == 56 and profile['backend']['schema'] == 'tickergarden_bsc', 'BSC isolation mismatch'
print(f'Validated {len(services)} isolated services')
if a.check:
    raise SystemExit(0)
user = pwd.getpwnam('tickergarden')

def write(file, value, mode, owner=None):
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + file.name, dir=file.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(json.dumps(value, indent=2) + '\n')
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temporary, mode)
        if owner:
            os.chown(temporary, owner.pw_uid, owner.pw_gid)
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

for name, c in services.items():
    write(root / 'runtime' / (name + '.json'), c, 0o600, user)
    if c.get('bsc'):
        write(pathlib.Path(c['source']) / 'config/service-runtime.json', c['bscProfile'], 0o600, user)
# This file contains only public hostname to private network mappings, never keys.
# Containers bind-mount its inode: update the existing file after validation.
transport = root / 'private-transport.json'
transport.write_text(json.dumps(routes, indent=2) + '\n')
os.chmod(transport, 0o644)
print('Rendered runtime projections; restart only the services whose configuration changed')
