"""Prepare the four BSC SDK-backed services using the existing private Sentry DSN."""
import copy
import re
from pathlib import PurePosixPath
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

def configure_main_observability(config, commit):
    assert re.fullmatch(r'[0-9a-f]{40}', commit), 'Accepted main source commit required'
    result = copy.deepcopy(config)
    web = result['services']['web']
    assert web['environment'] == 'production', 'Production Web required'
    web['env'].update(TG_ENVIRONMENT='production', TG_RELEASE_COMMIT=commit)
    result.setdefault('workerObservability', {})['tickergarden-confirmed-display-production'] = {
        'TG_RELEASE_COMMIT': commit, 'TG_CHAIN_ID': '4663',
    }
    return result

def worker_observability_projections(config, root):
    """Later EnvironmentFile wins over the legacy shared worker env file."""
    if not config.get('workerObservability'):
        return []
    root = PurePosixPath(root)
    assert re.fullmatch(r'/opt/tickergarden-hosting/releases/[a-zA-Z0-9-]+', str(root)), 'Unexpected release root'
    output = []
    for name, values in config.get('workerObservability', {}).items():
        assert name in ['tickergarden-confirmed-display-production', 'tickergarden-resident-worker-production'], 'Unexpected worker'
        assert set(values) == {'TG_RELEASE_COMMIT', 'TG_CHAIN_ID'}, 'Only public release metadata is allowed'
        assert re.fullmatch(r'[0-9a-f]{40}', values['TG_RELEASE_COMMIT']) and values['TG_CHAIN_ID'] == '4663', 'Invalid worker identity'
        env_file = root / 'runtime' / (name + '-observability.env')
        dropin = PurePosixPath('/etc/systemd/system') / (name + '.service.d') / '90-observability-release.conf'
        output += [(str(env_file), ''.join(f'{key}={value}\n' for key, value in sorted(values.items()))),
                   (str(dropin), '[Service]\nEnvironmentFile=' + str(env_file) + '\n')]
    return output
