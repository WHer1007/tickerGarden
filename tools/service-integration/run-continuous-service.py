"""Run the current binaries against the isolated new-release database; no signer."""
import json,os,pathlib,sys,subprocess
from urllib.parse import urlparse
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'outputs/reviews/continuous-service-2026-09-07'
if len(sys.argv)<2 or sys.argv[1] not in ['api','indexer','discovery-worker','projection-worker','event-worker','event-api','activity-worker']:raise SystemExit('Unsupported service')
cfg=json.loads((out/'config.json').read_text());db=json.loads((out/'database.json').read_text())
env=dict(os.environ,TG_ENV='test',TG_CHAIN_ID='421614',TG_RPC_URL=(cfg['projectionRpc'] if sys.argv[1] in ['projection-worker','event-worker','activity-worker'] else cfg['stateRpc'] if sys.argv[1]=='api' else cfg['rpc']),TG_DEPLOYMENT_MANIFEST=str(out/'manifest.json'),TG_HTTP_ADDR=cfg['apiAddress'],TG_DISCOVERY_EMPTY_BATCH_SIZE='256',TG_WEB_ORIGIN='http://127.0.0.1:5195')
# Optional authenticated archive RPC is loaded only into the child environment.
# Never copy it to the public configuration or command line.
if sys.argv[1] in ['api','projection-worker','event-worker','activity-worker']:
 private_rpc=os.environ.get('ARBITRUM_SEPOLIA_RPC_URL','')
 if not private_rpc and (root/'.env').exists():
  loaded=subprocess.run(['node','--env-file='+str(root/'.env'),'-e',"process.stdout.write(process.env.ARBITRUM_SEPOLIA_RPC_URL || '')"],capture_output=True,text=True)
  if loaded.returncode != 0:raise SystemExit('Cannot load local RPC environment')
  private_rpc=loaded.stdout.strip()
 if private_rpc:
  if urlparse(private_rpc).scheme!='https' or not urlparse(private_rpc).hostname:raise SystemExit('Invalid archive RPC URL')
  env['TG_RPC_URL']=private_rpc
for key in ['DATABASE_URL','INDEXER_DATABASE_URL','DISCOVERY_DATABASE_URL','PROJECTION_DATABASE_URL','EVENT_DATABASE_URL','ACTIVITY_DATABASE_URL']:env['TG_'+key]=db['url']
for key in ['INDEXER_START_BLOCK','DISCOVERY_START_BLOCK','PROJECTION_START_BLOCK','EVENT_START_BLOCK','ACTIVITY_START_BLOCK']:env['TG_'+key]=str(cfg['startBlock'] if key=='INDEXER_START_BLOCK' else cfg['businessStartBlock'])
# Enabled only for this migrated, isolated test release database.
if sys.argv[1]=='projection-worker':env.setdefault('TG_SCOPED_OBSERVATIONS','1')
binary=root/'services/backend-go/bin'/sys.argv[1]
os.execve(str(binary),[str(binary),*sys.argv[2:]],env)
