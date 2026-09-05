"""Freeze the user-selected Pons create asset universe. No RPC/write/activation side effects."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
OBS = ROOT / 'outputs/reviews/pons-v2-create/paired-assets-observed.json'
RH = ROOT / 'outputs/reviews/pons-v2-create/robinhood-assets.json'
IDENTITIES = ROOT / 'outputs/reviews/pons-v2-create/token-identities.json'
OUT = ROOT / 'deployments/manifests/robinhood-mainnet-4663.paired-assets.json'

def generate():
    observed = json.loads(OBS.read_text())
    official = json.loads(RH.read_text())
    identities = json.loads(IDENTITIES.read_text())
    assert observed['chain']['id'] == 4663
    assets = []
    for asset in [observed['native'], *observed['approvedPairs']]:
        assert asset['approved'] is True
        assert 6 <= asset['decimals'] <= 18
        assert int(asset['phantomQuote']) > 0 and int(asset['graduationThreshold']) > 0
        address = asset['address'].lower()
        matches = [a for a in official['assets'] if any(d['chainId'] == 4663 and d['contractAddress'].lower() == address for d in a['deployments'])]
        assert len(matches) <= 1
        native = address == '0x' + '0' * 40
        stock = matches[0] if matches else None
        identity = next((i for i in identities['tokens'] if i['address'].lower() == address), None)
        slots = next((i for i in identities['proxySlotChecks'] if i['address'].lower() == address), None)
        if not native:
            assert identity and identity['ok'] and identity['observedDecimals'] == asset['decimals'] and identity['observedSymbol'] == asset['symbol']
        if stock:
            assert stock['tokenSymbol'] == asset['symbol'] and stock['tokenDecimals'] == asset['decimals']
        assets.append({
            'symbol': asset['symbol'], 'name': stock['tokenName'] if stock else asset.get('name', 'Ether'),
            'chainId': 4663, 'tokenAddress': address, 'decimals': asset['decimals'],
            'assetKind': 'NATIVE' if native else 'OFFICIAL_STOCK' if stock else 'ERC20',
            'assetUid': stock['id'] if stock else None,
            'officialStatus': stock['status'] if stock else None,
            'currentMultiplier': stock['currentMultiplier'] if stock else None,
            'pendingMultiplier': stock['pendingMultiplier'] if stock else None,
            'phantomQuote': asset['phantomQuote'], 'graduationThreshold': asset['graduationThreshold'],
            'includedInRelease': True,
            'activationStatus': 'REGISTRY_ACTIVATION_REQUIRED',
            'runtimeCodeHash': identity['runtimeCodeHash'] if identity else None,
            'proxySlots': slots if slots else None,
            'admissionPath': 'ADMIN_REVIEWED_WHITELIST',
        })
    assert len({a['tokenAddress'] for a in assets}) == len(assets)
    assert len({a['symbol'] for a in assets}) == len(assets)
    return {
        'schemaVersion': 1, 'chainId': 4663,
        'status': 'RELEASE_ASSET_UNIVERSE_SELECTED_NOT_CHAIN_ACTIVATED',
        'selectionSource': 'USER_REQUEST_PONS_V2_CREATE_PARITY_2026_09_05',
        'economicsPolicy': 'PONS_V2_OBSERVED_RAW_UNITS_NO_RUNTIME_PRICE_CONVERSION',
        'sourceFactory': observed['factory']['address'].lower(), 'observedAt': observed['observedAt'],
        'observation': {'stateReadTag': observed['stateReadTag'], 'snapshotGuarantee': observed['snapshotGuarantee'], 'latestBlock': observed['chain']['latestBlock']},
        'evidence': [{'path': str(p.relative_to(ROOT)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in [OBS, RH, IDENTITIES]],
        'activationRequirements': ['Matching target chain', 'Own ACTIVE quote config and matching baseline', 'Administrator risk review and whitelist admission', 'Exact transfer evidence and finalized deployment preflight', 'Governance registration receipt; inclusion here never bypasses Registry'],
        'supplyReferenceRaw': '1000000000000000000000000000',
        'assets': assets,
        'excluded': [{'symbol': a['symbol'], 'tokenAddress': a['address'].lower(), 'reason': 'NOT_APPROVED_BY_PONS_V2_AT_OBSERVATION'} for a in observed['rejectedCandidates']],
    }

if __name__ == '__main__':
    output = json.dumps(generate(), indent=2) + '\n'
    if '--check' in sys.argv:
        if not OUT.exists() or OUT.read_text() != output: raise SystemExit('Release paired-asset whitelist drift; run python3 tools/generate-v1-paired-assets.py')
    else:
        OUT.write_text(output)
    print('Verified release paired-asset whitelist: ' + str(len(json.loads(output)['assets'])) + ' assets')
