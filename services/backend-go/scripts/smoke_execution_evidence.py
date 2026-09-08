"""Actual FeeVault runtime on disposable Anvil; mock registry/token/conversion route.
Not full protocol or production deployment acceptance. No external RPC accepted.
"""
import argparse
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument("--native",action="store_true")
parser.add_argument("--staker",action="store_true")
parser.add_argument("--mature",action="store_true")
args=parser.parse_args()
if args.mature and not args.staker:parser.error("--mature requires --staker")
native=args.native
staker=args.staker
root=Path(__file__).resolve().parents[1]
repo=root.parents[1]
forge=os.environ.get('FORGE') or shutil.which('forge')
anvil=os.environ.get('ANVIL') or shutil.which('anvil')
if not forge or not anvil: raise SystemExit('FORGE and ANVIL required')
subprocess.run([forge,'build','src/v1/modules/ProtocolFeeVault.sol','src/v1/modules/MemeStockGauge.sol','--extra-output','storageLayout'],cwd=repo/'contracts',check=True,stdout=subprocess.DEVNULL)
vault_art=json.loads((repo/'contracts/out/ProtocolFeeVault.sol/ProtocolFeeVault.json').read_text())
with tempfile.TemporaryDirectory(prefix='tg-execution-') as folder:
 d=Path(folder);(d/'src').mkdir()
 shutil.copy(root/'scripts/fixtures/ExecutionEvidence.sol',d/'src/ExecutionEvidence.sol')
 shutil.copy(repo/'contracts/src/v1/interfaces/IV1Protocol.sol',d/'src/IV1Protocol.sol')
 (d/'foundry.toml').write_text('[profile.default]\nsolc_version="0.8.26"\nevm_version="cancun"\noptimizer=true\noptimizer_runs=200\nbytecode_hash="none"\ncbor_metadata=false\n')
 subprocess.run([forge,'build'],cwd=d,check=True,stdout=subprocess.DEVNULL)
 with socket.socket() as sock: sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 url=f'http://127.0.0.1:{port}'
 process=subprocess.Popen([anvil,'--host','127.0.0.1','--port',str(port),'--chain-id','46630','--silent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 def rpc(method,params):
  req=urllib.request.Request(url,json.dumps(dict(jsonrpc='2.0',id=1,method=method,params=params)).encode(),{'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=30) as response: obj=json.load(response)
  if 'error' in obj: raise RuntimeError(f'{method}: {obj["error"]}')
  return obj['result']
 try:
  for _ in range(200):
   if process.poll() is not None: raise RuntimeError('Anvil exited')
   try: accounts=rpc('eth_accounts',[]);break
   except OSError: time.sleep(.025)
  else: raise RuntimeError('Anvil startup timeout')
  sender,user=accounts[:2]
  word=lambda x: format(x,'064x') if isinstance(x,int) else x.removeprefix('0x').zfill(64)
  def selector(sig): return rpc('web3_sha3',['0x'+sig.encode().hex()])[:10]
  def send(to,data):
   tx=dict(from_=sender,data=data,gas='0x989680',type='0x2',maxFeePerGas='0x174876e800',maxPriorityFeePerGas='0x3b9aca00');tx['from']=tx.pop('from_')
   if to:tx['to']=to
   h=rpc('eth_sendTransaction',[tx]);r=None
   for _ in range(200):
    r=rpc('eth_getTransactionReceipt',[h])
    if r:break
    time.sleep(.025)
   if not r or r['status']!='0x1':raise RuntimeError(f'fixture transaction failed {h}: {rpc("debug_traceTransaction",[h,{"tracer":"callTracer"}])}')
   return r
  def deploy(name,args=''):
   a=json.loads((d/f'out/ExecutionEvidence.sol/{name}.json').read_text())
   return send(None,a['bytecode']['object']+args)['contractAddress']
  meme=deploy('EvidenceToken');quote='0x'+'00'*20 if native else deploy('EvidenceToken');registry=deploy('EvidenceRegistry');creators=deploy('EvidenceCreators',word(user));hook=deploy('EvidenceHook',word(meme)+word(quote))
  manager=deploy('EvidenceManager')
  policy='0x'+'11'*32
  vault=send(None,vault_art['bytecode']['object']+word(registry)+word(manager)+word(creators)+word(sender)+word(policy))['contractAddress']
  send(registry,selector('configure(address,address,address)')+word(meme)+word(quote)+word(hook))
  send(meme,selector('mint(address,uint256)')+word(vault)+word(100))
  if native:
   rpc('anvil_setBalance',[vault,hex(1000)]);rpc('anvil_setBalance',[hook,hex(1000)])
  else:send(quote,selector('mint(address,uint256)')+word(vault)+word(1000))
  market='0x'+'aa'*32
  layout={x['label']:int(x['slot']) for x in vault_art['storageLayout']['storage']}
  def mapping(key,slot):return int(rpc('web3_sha3',['0x'+word(key)+word(slot)]),16)
  def seed(slot,n):rpc('anvil_setStorageAt',[vault,'0x'+word(slot),'0x'+word(n)])
  gauge=''
  if staker:
   ga=json.loads((repo/'contracts/out/MemeStockGauge.sol/MemeStockGauge.json').read_text())
   implementation=send(None,ga['bytecode']['object'])['contractAddress']
   runtime='363d3d373d3d3d363d73'+implementation[2:]+'5af43d82803e903d91602b57fd5bf3'+word(market)+word(policy)+word(policy)+word(manager)+word(vault)+word(quote)+word(meme)
   gauge=send(None,'0x61'+format(len(runtime)//2,'04x')+'80600a3d393df3'+runtime)['contractAddress']
   send(registry,selector('setGauge(address)')+word(gauge))
   gl={x['label']:int(x['slot']) for x in ga['storageLayout']['storage']}
   def gs(slot,n):rpc('anvil_setStorageAt',[gauge,'0x'+word(slot),'0x'+word(n)])
   position=mapping(user,gl['_gaugePositions'])
   gs(position,1)
   gs(position+1,1)
   now=int(rpc('eth_getBlockByNumber',['latest',False])['timestamp'],16)
   generation=now-1 if args.mature else now+864000
   gs(position+2,generation+((now+864000)<<64))
   gs(position+4,9);gs(position+7,2)
   gs(gl['_rewardStates'],10**27);gs(gl['_rewardStates']+2,10**27)
   gs(gl['_storedTotalActiveStock'],1);gs(gl['_totalPendingStock'],1)
   wheel=gl['_activationWheel']+(generation%32)*3
   gs(wheel,generation);gs(wheel+1,1);gs(wheel+2,1)
  # Seed pre-existing liabilities only; transaction executes unmodified FeeVault.
  for asset,n in [(meme,3),(quote,10)]:
   if not staker:seed(mapping(asset,mapping(1,mapping(market,layout['_creatorLiabilities']))),n)
   seed(mapping(asset,mapping(market,layout['_bucketLiabilities']))+(1 if staker else 0),n)
   seed(mapping(asset,layout['_totalLiabilities']),n)
  head=rpc('eth_getBlockByNumber',['latest',False]);deadline=int(head['timestamp'],16)+300
  data=selector('settleRewards(bytes32,(address,uint32,uint256)[],uint256,uint256)')+word(market)+word(128)+word(99)+word(deadline)+word(1)+word(user)+word(0 if staker else 1)+word(5)
  r=send(vault,data)
  rpc('anvil_mine',['0x41'])
  fixture=dict(url=url,transactionHash=r['transactionHash'],sender=sender,user=user,vault=vault,meme=meme,quote=quote,hook=hook,market=market,deadline=deadline,data=data,gauge=gauge,staker=staker,mature=args.mature,rawTransaction=rpc("eth_getRawTransactionByHash",[r["transactionHash"]]))
  path=d/'input.json';path.write_text(json.dumps(fixture))
  subprocess.run(['go','test','-race','-count=1','./internal/settlement','-run','^TestIsolatedSettlementReceiptExecutionHistory$' if os.environ.get('TG_SETTLEMENT_TEST_DSN') else '^TestLocalFeeVaultExecutionEvidence$','-v'],cwd=root,env=dict(os.environ,TG_LOCAL_EXECUTION_FIXTURE=str(path)),check=True)
  print(('native quote: ' if native else 'ERC20 quote: ')+('Staker ' if staker else 'Creator ')+'PASS: actual FeeVault partial-fill trace and replay; route dependencies mocked; full protocol acceptance pending')
 finally:
  process.terminate()
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:process.kill();process.wait()
