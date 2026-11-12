"""Validated Worker projections from the canonical host configuration; no I/O or RPC."""
import copy
import json
import re
from urllib.parse import urlsplit

def worker_projections(config):
    workers = config.get('productionWorkers', {})
    if not workers:
        return []
    assert set(workers) == {'bsc-display', 'bsc-relay'}, 'Both BSC workers must be configured'
    services = config['services']
    read = services['bsc-read']['bscProfile']['backend']['runtime']
    pipeline = services['bsc-pipeline']['bscProfile']['backend']['runtime']
    for runtime in [read, pipeline]:
        assert runtime.get('TG_RPC_CONTROL_ENABLED') == 'true', 'Shared RPC budget required'
    policy = json.loads(read['TG_RPC_BUDGETS_JSON'])
    assert policy == json.loads(pipeline['TG_RPC_BUDGETS_JSON']) and set(policy) == {'quicknode'}, 'BSC shared budgets disagree'
    budget = policy['quicknode']
    for key in ['rps', 'burst', 'interactiveReserve', 'backgroundConcurrency', 'nonInteractiveConcurrency']:
        assert type(budget[key]) is int and budget[key] > 0, 'Invalid budget'
    assert budget['interactiveReserve'] < budget['burst'] and budget['backgroundConcurrency'] <= budget['nonInteractiveConcurrency'], 'Invalid budget reserves'
    token = read.get('TG_RPC_BUDGET_TOKEN', '')
    assert len(token) >= 32, 'Private permit authentication required'
    database = services['bsc-pipeline']['bscProfile']['backend']['database']['pipeline']
    parsed = urlsplit(database)
    assert parsed.scheme in ['postgres', 'postgresql'] and parsed.path == '/tickergarden_bsc' and parsed.username == 'bsc_pipeline', 'Isolated BSC control database required'
    permit_origin = 'https://tickergarden-bsc-read-api.vercel.app'
    assert services['bsc-read']['transport'].get(permit_origin) == 'http://172.18.0.1:8211', 'Permit requests must use the private Read API mapping'
    output = []
    for name, entry in workers.items():
        path = entry['profilePath']
        assert re.fullmatch(r'/opt/tickergarden-bsc/releases/[a-zA-Z0-9-]+/config/service-runtime.json', path), 'Unexpected Worker profile path'
        profile = copy.deepcopy(entry['profile'])
        backend = profile['backend']
        assert profile['chainId'] == 56 and backend['environment'] == 'production' and backend['schema'] == 'tickergarden_bsc', 'Worker isolation mismatch'
        rpc = urlsplit(profile['rpcUrl'])
        assert rpc.scheme == 'https' and rpc.hostname.endswith('.quiknode.pro') and not profile.get('verificationRpcUrl') and not backend.get('verificationRpcUrl'), 'QuickNode only'
        runtime = backend.setdefault('runtime', {})
        runtime.update(TG_RPC_CONTROL_ENABLED='true', TG_RPC_BUDGETS_JSON=json.dumps(policy, separators=(',', ':')), TG_RPC_CONTROL_DATABASE_URL=database, TG_RPC_BUDGET_TOKEN=token, TG_RPC_BUDGET_URL=permit_origin, TG_RPC_BUDGET_ACCESS_TOKEN=read.get('TG_CANDIDATE_ACCESS_TOKEN', ''))
        output.append((path, profile))
    assert len({p for p, _ in output}) == 2, 'Worker profiles must be distinct'
    return output
