"""Pin Gauge runtime and verify every layout offset used by the Go decoder."""
import argparse
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
target = root / 'services/backend-go/internal/settlement/gauge_storage.json'

def generate():
    subprocess.run([os.environ.get('FORGE', 'forge'), 'build', 'src/v1/modules/MemeStockGauge.sol', '--extra-output', 'storageLayout'], cwd=root / 'contracts', check=True, stdout=subprocess.DEVNULL, env={**os.environ, "FOUNDRY_PROFILE": "v1"})
    a = json.loads((root / 'contracts/out-v1/MemeStockGauge.sol/MemeStockGauge.json').read_text())
    l = a['storageLayout']; types = l['types']
    def entry(name):
        found = [s for s in l['storage'] if s['label'] == name]
        if len(found) != 1 or found[0]['offset'] != 0: raise ValueError(name)
        return found[0]
    def members(typ, expected, size):
        node = types[typ]
        got = [(m['label'], int(m['slot']), m['offset'], types[m['type']]['label']) for m in node['members']]
        if got != expected or int(node['numberOfBytes']) != size: raise ValueError('unsupported struct layout: ' + typ)
    def mapping(name, key):
        node=types[entry(name)['type']]
        if node['encoding']!='mapping' or types[node['key']]['label']!=key:raise ValueError(name)
        return node['value']
    def array(typ, length, size):
        node=types[typ]
        if node['encoding']!='inplace' or not node['label'].endswith(f'[{length}]') or int(node['numberOfBytes'])!=size:raise ValueError(typ)
        return node['base']
    p = mapping('_gaugePositions', 'address')
    members(p, [('activeAmount',0,0,'uint256'),('pendingAmount',1,0,'uint256'),('pendingGeneration',2,0,'uint64'),('unlockAt',2,8,'uint64'),('rewards',3,0,'struct MemeStockGaugeActivationSnapshots.GaugeUserReward[2]')], 288)
    reward = array(types[p]['members'][4]['type'],2,192)
    members(reward,[('accumulatorPaid',0,0,'uint256'),('pendingFee',1,0,'uint256'),('userRemainder',2,0,'uint256')],96)
    members(mapping('_activationSnapshots','uint64'),[('quoteAccumulator',0,0,'uint256'),('memeAccumulator',1,0,'uint256'),('refs',2,0,'uint256'),('processed',3,0,'bool')],128)
    members(array(entry('_activationWheel')['type'],32,3072),[('generation',0,0,'uint64'),('amount',1,0,'uint256'),('refs',2,0,'uint256')],96)
    members(array(entry('_rewardStates')['type'],2,128),[('accFeePerShare',0,0,'uint256'),('indexRemainder',1,0,'uint256')],64)
    for name in ('_storedTotalActiveStock', '_totalPendingStock', '_observedRewardCohortEpoch', '_deferredQuoteForfeiture', '_deferredMemeForfeiture'):
        node=types[entry(name)['type']]
        if node['label']!='uint256' or node['numberOfBytes']!='32' or node['encoding']!='inplace':raise ValueError(name)
    precision=array(entry('_forfeiturePrecisionRemainders')['type'],2,64)
    if types[precision]['label']!='uint256':raise ValueError('forfeiture precision layout')
    d=a['deployedBytecode']
    if d.get('immutableReferences') or d.get('linkReferences'):raise ValueError('Gauge runtime references unsupported')
    code=bytes.fromhex(d['object'].removeprefix('0x'))
    return json.dumps({'runtime':'0x'+code.hex(),'positions':entry('_gaugePositions')['slot'],'snapshots':entry('_activationSnapshots')['slot'],'wheel':entry('_activationWheel')['slot'],'rewards':entry('_rewardStates')['slot'],'activeTotal':entry('_storedTotalActiveStock')['slot'],'pendingTotal':entry('_totalPendingStock')['slot'],'cohort':entry('_observedRewardCohortEpoch')['slot'],'precision':entry('_forfeiturePrecisionRemainders')['slot'],'deferredQuote':entry('_deferredQuoteForfeiture')['slot'],'deferredMeme':entry('_deferredMemeForfeiture')['slot']},indent=2)+'\n'

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args();body=generate()
    if args.check:
        if not target.exists() or target.read_text()!=body:raise SystemExit('Gauge storage artifact stale; run scripts/generate_gauge_storage.py')
    else:target.write_text(body)
