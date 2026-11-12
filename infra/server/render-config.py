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
import ipaddress
import tempfile
from urllib.parse import urlsplit

def project_networks(projection, services):
    for service, networks in services.items():
        entry = projection.setdefault('services', {}).setdefault(service, {})
        current = entry.get('networks') or {}
        if isinstance(current, list):
            current = {name: {} for name in current}
        assert isinstance(current, dict), 'Invalid Compose networks'
        entry['networks'] = current
        for network, address in networks.items():
            current[network] = {**(current.get(network) or {}), 'ipv4_address': address}
    return projection

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--config', default='/etc/tickergarden/hosting.json')
p.add_argument('--root', required=True)
p.add_argument('--check', action='store_true')
a = p.parse_args()
root = pathlib.Path(a.root).resolve()
config = json.loads(pathlib.Path(a.config).read_text())
services = config['services']
network_projections = config.get('composeNetworkProjections', [])
seen = set()
for network_projection in network_projections:
    assert network_projection['file'] in ['/opt/tickergarden/production-init.override.json', '/opt/tickergarden/production-release.override.json', '/opt/tickergarden/test-release.override.json'], 'Unexpected Compose projection path'
    for service, networks in network_projection['services'].items():
        assert re.fullmatch(r'[a-z][a-z0-9-]+', service), 'Invalid Compose service'
        for network, address in networks.items():
            subnet = {'edge': '172.18.0.0/16', 'production': '172.19.0.0/16', 'test': '172.20.0.0/16'}.get(network)
            assert subnet and ipaddress.ip_address(address) in ipaddress.ip_network(subnet), 'Invalid container address'
            assert address not in seen and not address.endswith('.0') and not address.endswith('.1'), 'Duplicate/reserved container address'
            seen.add(address)
retention = config.get('journalRetention')
if retention:
    assert 64 <= retention['systemMaxMiB'] <= 2048 and 16 <= retention['runtimeMaxMiB'] <= 512 and 1 <= retention['days'] <= 30, 'Invalid journal retention'
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
projected_networks = [(pathlib.Path(n['file']), project_networks(json.loads(pathlib.Path(n['file']).read_text()), n['services'])) for n in network_projections]
for service, image in config.get('productionContainerImages', {}).items():
    assert service in ['chain-event-relay-prod', 'queue-prod', 'tickergarden-bsc-queue-prod-1'], 'Unexpected production container'
    assert re.fullmatch(r'[a-z0-9-]+:[a-z0-9-]+', image['image']), 'Invalid local image'
    assert re.fullmatch(r'sha256:[a-f0-9]{64}', image['digest']) and re.fullmatch(r'[a-f0-9]{40}', image['commit']), 'Invalid image provenance'
    if service == 'tickergarden-bsc-queue-prod-1':
        continue  # This standalone container is recreated by the release script.
    target = next((projection for file, projection in projected_networks if str(file) == '/opt/tickergarden/production-release.override.json'), None)
    assert target is not None, 'Production Compose projection required'
    entry = target.setdefault('services', {}).setdefault(service, {})
    entry['image'] = image['image']
    entry['environment'] = {**(entry.get('environment') or {}), 'TG_RELEASE_COMMIT': image['commit'], 'TG_IMAGE_DIGEST': image['digest']}

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
for file, projection in projected_networks:
    write(file, projection, 0o600)
    print('Rendered pinned Compose network addresses; no containers recreated')

if retention:
    destination = pathlib.Path('/etc/systemd/journald.conf.d/60-tickergarden.conf')
    destination.parent.mkdir(parents=True, exist_ok=True)
    text = '[Journal]\nSystemMaxUse={systemMaxMiB}M\nRuntimeMaxUse={runtimeMaxMiB}M\nMaxRetentionSec={days}day\nCompress=yes\n'.format(**retention)
    fd, temporary = tempfile.mkstemp(prefix='.tickergarden-', dir=destination.parent)
    with os.fdopen(fd, 'w') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(temporary, 0o644)
    os.replace(temporary, destination)
