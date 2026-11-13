"""Prepare the four BSC SDK-backed services using the existing private Sentry DSN."""
import copy
import re
from urllib.parse import urlsplit

def configure_bsc_observability(config, commit):
    assert re.fullmatch(r'[0-9a-f]{40}', commit), 'Accepted BSC source commit required'
    result = copy.deepcopy(config)
    dsn = result['services']['rh-pipeline']['env']['TG_SENTRY_DSN']
    parsed = urlsplit(dsn)
    assert parsed.scheme == 'https' and parsed.hostname.endswith('.sentry.io') and parsed.username and not parsed.password, 'Existing Sentry DSN required'
    values = {'TG_SENTRY_DSN': dsn, 'TG_CHAIN_ID': '56', 'TG_RELEASE_COMMIT': commit}
    for name in ['bsc-read', 'bsc-pipeline', 'bsc-content']:
        service = result['services'][name]
        assert service['environment'] == 'production' and service['bscProfile']['chainId'] == 56
        service['env'].update(values)
        service['bscProfile']['backend']['runtime'].update(values)
    result['productionWorkers']['bsc-display']['profile']['backend']['runtime'].update(values)
    return result
