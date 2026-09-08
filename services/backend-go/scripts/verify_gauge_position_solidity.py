"""Check Go replay vectors against the actual Solidity position-settlement layer.

Uses a temporary harness and local Forge VM only; never connects to an RPC.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
repo = root.parents[1]
forge = os.environ.get('FORGE') or shutil.which('forge')
if not forge:
    raise SystemExit('forge is required for the Gauge position Solidity check')
vectors = json.loads((root / 'internal/settlement/testdata/gauge-position.json').read_text())

def reward(r):
    return 'MemeStockGaugeActivationSnapshots.GaugeUserReward(' + ','.join(str(int(r[k])) for k in ('paid', 'pending', 'remainder')) + ')'

def position(p):
    values = [str(int(p[k])) for k in ('active', 'pending', 'generation', 'unlockAt')]
    return 'MemeStockGaugeActivationSnapshots.GaugePosition(' + ','.join(values) + ',[' + ','.join(reward(r) for r in p['rewards']) + '])'

def snapshot(s):
    return 'ActivationSnapshot(' + ','.join(str(int(n)) for n in s['accumulators']) + ',' + str(int(s['refs'])) + ',' + str(s['processed']).lower() + ')'

functions = []
for i, v in enumerate(vectors):
    b = v['bucket']
    args = [position(v['before']), snapshot(v['snapshot']),
            'ActivationSlot(' + ','.join(str(int(b[k])) for k in ('generation', 'amount', 'refs')) + ')',
            '[uint256(' + str(int(v['current'][0])) + '),uint256(' + str(int(v['current'][1])) + ')]']
    args += [str(int(v[k])) for k in ('maximum', 'refund', 'quote')]
    expected = v['expected']
    functions.append(f'''function testVector{i}() public {{
        vm.warp({int(v['timestamp'])}); H h = new H();
        (MemeStockGaugeActivationSnapshots.GaugePosition memory p, ActivationSnapshot memory s, uint256 pulled) = h.run({','.join(args)});
        require(keccak256(abi.encode(p)) == keccak256(abi.encode({position(expected['position'])})), "position mismatch");
        require(keccak256(abi.encode(s)) == keccak256(abi.encode({snapshot(expected['snapshot'])})), "snapshot mismatch");
        require(pulled == {int(expected['pulled'])}, "pull mismatch");
    }}''')

source = '''// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {MemeStockGaugeActivationSnapshots} from "../src/v1/shared/MemeStockGaugeActivationSnapshots.sol";
import {MemeStockGaugeSettlements} from "../src/v1/shared/MemeStockGaugeSettlements.sol";
import {ActivationSnapshot,ActivationSlot} from "../src/v1/interfaces/IV1Protocol.sol";
interface Vm { function warp(uint256) external; }
contract H is MemeStockGaugeSettlements {
 function checkRemainderRollover() external {
  _rewardStates[0].indexRemainder=2e27+5e26;
  _rewardStates[1].indexRemainder=25e25;
  _forfeiturePrecisionRemainders[0]=5e26;
  _forfeiturePrecisionRemainders[1]=25e25;
  require(_collectForfeitedReward(0,0,0,true)==3,"quote carry mismatch");
  require(_collectForfeitedReward(1,0,0,true)==0,"meme carry mismatch");
  require(_rewardStates[0].indexRemainder==0 && _rewardStates[1].indexRemainder==0,"global remainder retained");
  require(_forfeiturePrecisionRemainders[0]==0 && _forfeiturePrecisionRemainders[1]==5e26,"precision mismatch");
  require(_collectForfeitedReward(0,0,0,true)==0 && _collectForfeitedReward(1,0,0,true)==0,"double reserve");
 }

 function runWheel() external returns(uint256,uint256,uint256,uint256,uint256) {
  _rewardStates[0].accFeePerShare=1e27;_rewardStates[1].accFeePerShare=1e27;
  _activationWheel[26]=ActivationSlot(90,9,2);
  _activationWheel[27]=ActivationSlot(91,7,3);
  _activationWheel[2]=ActivationSlot(130,5,1);
  _storedTotalActiveStock=3;_totalPendingStock=21;
  _gaugePositions[address(1)].activeAmount=3;
  _gaugePositions[address(1)].pendingAmount=4;
  _gaugePositions[address(1)].pendingGeneration=90;
  _settlePosition(address(1),bytes32(uint256(1)));
  require(_activationWheel[26].generation==0 && _activationWheel[27].generation==0,"mature buckets remained");
  require(_activationWheel[2].generation==130 && _activationWheel[2].refs==1,"future bucket changed");
  require(_activationSnapshots[91].quoteAccumulator==1e27 && _activationSnapshots[91].memeAccumulator==1e27 && _activationSnapshots[91].processed,"unrelated snapshot mismatch");
  return(_storedTotalActiveStock,_totalPendingStock,_activationSnapshots[90].refs,_activationSnapshots[91].refs,_activationWheel[2].amount);
 }

 function run(GaugePosition memory beforePosition, ActivationSnapshot memory snap, ActivationSlot memory bucket,
              uint256[2] memory current, uint256 maximum, uint256 refund, uint256 quote)
 external returns(GaugePosition memory,ActivationSnapshot memory,uint256 pulled) {
  address user=address(1);uint64 generation=beforePosition.pendingGeneration;
  _gaugePositions[user]=beforePosition;
  _activationSnapshots[generation]=snap;
  _rewardStates[0].accFeePerShare=current[0];_rewardStates[1].accFeePerShare=current[1];
  if(bucket.generation!=0){_activationWheel[uint8(bucket.generation%32)]=bucket;_totalPendingStock=bucket.amount;}
  _settlePosition(user,bytes32(uint256(1)));
  GaugeUserReward storage meme=_gaugePositions[user].rewards[1];
  pulled=meme.pendingFee<maximum?meme.pendingFee:maximum;
  meme.pendingFee-=pulled;meme.pendingFee+=refund;
  _gaugePositions[user].rewards[0].pendingFee+=quote;
  return(_gaugePositions[user],_activationSnapshots[generation],pulled);
 }
}
contract GaugePositionTest {
 Vm constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
 function testRemainderRollover() public {H h=new H();h.checkRemainderRollover();}

 function testAllActivationBuckets() public {
  vm.warp(100);H h=new H();
  (uint256 active,uint256 pending,uint256 ownRefs,uint256 otherRefs,uint256 future)=h.runWheel();
  require(active==19 && pending==5 && ownRefs==1 && otherRefs==3 && future==5,"global activation mismatch");
 }

''' + '\n'.join(functions) + '\n}\n'
with tempfile.TemporaryDirectory(prefix='tickergarden-gauge-position-') as tmp:
    directory = Path(tmp)
    shutil.copytree(repo / 'contracts/src', directory / 'src')
    (directory / 'test').mkdir()
    (directory / 'test/GaugePosition.t.sol').write_text(source)
    lib = repo / 'contracts/lib'
    # Absolute read-only dependency remappings avoid copying or modifying deps.
    mappings = [f'{key}={lib / val}' for key, val in [
        ('@openzeppelin/contracts/', 'openzeppelin-contracts/contracts/'),
        ('@uniswap/v4-core/', 'v4-periphery/lib/v4-core/'),
        ('@uniswap/v4-periphery/', 'v4-periphery/'),
        ('permit2/', 'v4-periphery/lib/permit2/')]]
    (directory / 'foundry.toml').write_text('[profile.default]\nsolc_version="0.8.26"\nevm_version="cancun"\noptimizer=true\nvia_ir=true\nremappings=' + json.dumps(mappings) + '\n')
    subprocess.run([forge, 'test', '--root', str(directory), '--match-path', 'test/GaugePosition.t.sol'], check=True)
