"""Run real built R6 services with the isolated integration database/manifest."""
import json,os,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'outputs/reviews/formal-clock-service-integration-2026-09-06/service-live'
cfg=json.loads((out/'rpc-config.json').read_text());db=json.loads((out/'database.json').read_text())
role=os.environ.get('SERVICE_DB_ROLE','tickergarden');url=db['url'].replace('tickergarden@',role+'@')
# Execution-state readers do not share the bulk ingestion relay's queue.
# Both paths independently validate the same chain, manifest and canonical pins.
rpc=os.environ.get('SERVICE_RPC_URL') or (cfg['stateUpstream'] if sys.argv[1]=='api' or sys.argv[1].startswith('treasury-') else 'http://127.0.0.1:18549')
env=dict(os.environ,TG_ENV='test',TG_CHAIN_ID='421614',TG_RPC_URL=rpc,TG_DEPLOYMENT_MANIFEST=str(out/'manifest.json'),TG_INDEXER_START_BLOCK=str(cfg['startBlock']),TG_DISCOVERY_START_BLOCK=str(cfg['startBlock']),TG_HTTP_ADDR='127.0.0.1:18550',TG_TREASURY_PROOF_MANIFEST=str(out/'manifest.json'))
for field in ['DATABASE_URL','INDEXER_DATABASE_URL','DISCOVERY_DATABASE_URL','TREASURY_DATABASE_URL','TREASURY_STORE_DATABASE_URL','TREASURY_JOBS_DATABASE_URL','TREASURY_REVIEW_DATABASE_URL','TREASURY_REVIEW_JOURNAL_URL','TREASURY_PUBLISH_DATABASE_URL','TREASURY_LIFECYCLE_DATABASE_URL']:
 env['TG_'+field]=url
for field in ['TREASURY_REVIEW_RPC_URL','TREASURY_PUBLISH_RPC_URL','TREASURY_LIFECYCLE_RPC_URL']:env['TG_'+field]=rpc
binary=root/'.codex_tmp/r6-fast-test/services/backend-go/bin'/sys.argv[1]
os.execve(str(binary),[str(binary),*sys.argv[2:]],env)
