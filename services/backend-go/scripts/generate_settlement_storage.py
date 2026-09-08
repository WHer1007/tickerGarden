"""Generate a compiler-coupled FeeVault layout/runtime template. Requires Forge.

Never use this template hash as a deployed runtime identity: immutable bytes must
also be authenticated against the deployment manifest at the observed block.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
TARGET = ROOT / 'services/backend-go/internal/settlement/feevault_storage.json'


def generate():
    subprocess.run([os.environ.get('FORGE', 'forge'), 'build',
                    'src/v1/modules/ProtocolFeeVault.sol', '--extra-output', 'storageLayout'],
                   cwd=ROOT / 'contracts', check=True, stdout=subprocess.DEVNULL, env={**os.environ, "FOUNDRY_PROFILE": "v1"})
    artifact = json.loads((ROOT / 'contracts/out-v1/ProtocolFeeVault.sol/ProtocolFeeVault.json').read_text())
    layout = artifact['storageLayout']
    def mapping_slot(label, keys, value):
        entries = [x for x in layout['storage'] if x['label'] == label]
        if len(entries) != 1 or entries[0]['offset'] != 0:
            raise ValueError('ambiguous or packed liability layout: ' + label)
        typ = entries[0]['type']
        for key in keys:
            node = layout['types'][typ]
            if node['encoding'] != 'mapping' or layout['types'][node['key']]['label'] != key:
                raise ValueError('unexpected mapping key: ' + label)
            typ = node['value']
        node = layout['types'][typ]
        if node['label'] != value:
            raise ValueError('unexpected mapping value: ' + label)
        if value == 'uint256[4]' and (node['encoding'] != 'inplace' or node['numberOfBytes'] != '128'
                or layout['types'][node['base']]['label'] != 'uint256'):
            raise ValueError('unexpected bucket packing')
        return entries[0]['slot']

    creator_slot = mapping_slot('_creatorLiabilities', ('bytes32', 'uint32', 'address'), 'uint256')
    bucket_slot = mapping_slot('_bucketLiabilities', ('bytes32', 'address'), 'uint256[4]')
    total_slot = mapping_slot('_totalLiabilities', ('address',), 'uint256')
    deployed = artifact['deployedBytecode']
    if deployed['linkReferences']:
        raise ValueError('linked runtime is unsupported')
    code = bytes.fromhex(deployed['object'].removeprefix('0x'))
    ranges = sorted((r for rs in deployed['immutableReferences'].values() for r in rs), key=lambda r: r['start'])
    end = 0
    for r in ranges:
        start, length = r['start'], r['length']
        if start < end or length != 32 or start + length > len(code) or any(code[start:start + length]):
            raise ValueError('invalid immutable reference')
        end = start + length
    result = {'creatorSlot': creator_slot, 'bucketSlot': bucket_slot, 'totalSlot': total_slot, 'runtime': '0x' + code.hex(), 'immutables': ranges}
    return json.dumps(result, indent=2) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = generate()
    if args.check:
        if not TARGET.exists() or TARGET.read_text() != result:
            raise SystemExit('FeeVault storage artifact is stale; run scripts/generate_settlement_storage.py')
    else:
        TARGET.write_text(result)
