import json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[2];out=root/'outputs/reviews/formal-clock-service-integration-2026-09-06/service-live';url=json.loads((out/'database.json').read_text())['url']
def query():
 r=subprocess.run(['psql',url,'-At','-c','SELECT row_to_json(x) FROM (SELECT chain_id,start_block,tip_number,tip_hash,finalized_number,finalized_hash FROM tickergarden.chain_journal WHERE chain_id=421614) x'],capture_output=True,text=True,check=True);return json.loads(r.stdout)
before=query();flag=out/'rpc-cache/FAIL_RPC';flag.touch()
try:
 r=subprocess.run(['python3',str(root/'tools/service-integration/run-service.py'),'indexer','--once'],capture_output=True,text=True,timeout=75)
 after=query();assert r.returncode!=0 and before==after,(r.returncode,before,after)
 (out/'indexer-rpc-fault.json').write_text(json.dumps({'before':before,'after':after,'exitCode':r.returncode,'stderr':r.stderr,'cursorUnchanged':True,'injectedFailure':'HTTP503 at local read relay for actual public-chain indexer','at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()},indent=2))
finally:flag.unlink()
print('PASS actual persistent indexer preserves checkpoint on HTTP503')
