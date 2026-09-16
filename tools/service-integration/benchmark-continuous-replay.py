"""Four fixed historical blocks in a disposable DB; no signer or publication."""
import datetime,json,os,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parents[2]
p=root/'outputs/reviews/continuous-service-2026-09-07'
cfg=json.loads((p/'config.json').read_text());db=json.loads((p/'benchmark-database.json').read_text())
assert '@127.0.0.1:' in db['url'] and '/service_replay_benchmark?' in db['url']
secret=subprocess.run(['node','--env-file='+str(root/'.env'),'-e',"process.stdout.write(process.env.ARBITRUM_SEPOLIA_RPC_URL || '')"],capture_output=True,text=True,check=True).stdout
assert secret.startswith('https://')
env=dict(os.environ,TG_ENV='test',TG_CHAIN_ID='421614',TG_RPC_URL=secret,TG_DEPLOYMENT_MANIFEST=str(p/'manifest.json'),TG_PROJECTION_DATABASE_URL=db['url'],TG_PROJECTION_START_BLOCK=str(cfg['businessStartBlock']))
results=[]
for expected in range(306128256,306128260):
 start=time.monotonic();r=subprocess.run([str(root/'services/backend-go/bin/projection-worker'),'--once'],env=env,capture_output=True,text=True,timeout=90)
 if r.returncode:
  # Worker errors are sanitized; never print process environment or endpoint.
  print(r.stderr);raise SystemExit(r.returncode)
 value=json.loads(r.stdout);assert value['action']=='projected' and value['blockNumber']==expected
 value['wallSeconds']=time.monotonic()-start;results.append(value)
 (p/'replay-benchmark.json').write_text(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Same four startup blocks as prior v25 replay, not populated-market throughput','blocks':results},indent=2)+'\n');print(json.dumps(value),flush=True)
