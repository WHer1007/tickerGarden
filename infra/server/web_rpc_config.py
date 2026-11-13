"""Derive private BSC Web budget wiring from hosting.json, without I/O."""
import copy
from urllib.parse import urlsplit


def web_rpc_projection(config):
    result = copy.deepcopy(config)
    services = result['services']
    for web in services.values():
        if web.get('kind') != 'web' or web.get('environment') != 'production':
            continue
        env = web['env']
        if not env.get('TG_BSC_WEB_RPC_URL'):
            continue
        read = services['bsc-read']
        profile = read['bscProfile']
        runtime = profile['backend']['runtime']
        assert profile['chainId'] == 56 and profile['backend']['environment'] == 'production' and profile['backend']['schema'] == 'tickergarden_bsc', 'BSC budget identity mismatch'
        assert runtime.get('TG_RPC_CONTROL_ENABLED') == 'true', 'BSC shared budget is required'
        rpc = urlsplit(env['TG_BSC_WEB_RPC_URL'])
        assert rpc.scheme == 'https' and not rpc.username and not rpc.password and (rpc.hostname or '').endswith('.quiknode.pro'), 'QuickNode only'
        assert not env.get('TG_BSC_WEB_RPC_FALLBACK_URL'), 'No production RPC fallback'
        token = runtime.get('TG_RPC_BUDGET_TOKEN', '')
        access = runtime.get('TG_CANDIDATE_ACCESS_TOKEN', '')
        assert len(token) >= 32 and token != env.get('TG_RPC_BUDGET_TOKEN'), 'Independent BSC permit credential required'
        assert len(access) >= 32, 'Private BSC Read API access required'
        origin = 'https://tickergarden-bsc-read-api.vercel.app'
        assert web['transport'].get(origin) == read['transport'].get(origin) == 'http://172.18.0.1:8211', 'BSC permits must use the private Read API'
        assert origin not in web.get('transportOverrides', {}), 'Budget must not route through the public Gateway'
        env.update(TG_BSC_RPC_CONTROL_ENABLED='true', TG_BSC_RPC_BUDGET_URL=origin,
                   TG_BSC_RPC_BUDGET_TOKEN=token, TG_BSC_RPC_BUDGET_ACCESS_TOKEN=access)
    return result
