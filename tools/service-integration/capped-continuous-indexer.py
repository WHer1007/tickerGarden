"""Consume prefetched finalized ranges using the real indexer and its transactions."""
import json,pathlib,subprocess,time,signal,sys
root=pathlib.Path(__file__).resolve().parents[2];out=root/'outputs/reviews/continuous-service-2026-09-07';url=json.loads((out/'database.json').read_text())['url'];child=None
failures=0
try:
 while True:
  s=json.loads((out/'rpc-cache/status.json').read_text());target=s['next']-1
  r=subprocess.run(['psql',url,'-At','-c','SELECT coalesce(tip_number,start_block-1) FROM tickergarden.chain_journal WHERE chain_id=421614'],capture_output=True,text=True,check=True);tip=int(r.stdout.strip())
  # Consume even the final partial range so the real finalized checkpoint can
  # advance at the actual finalized head, rather than waiting for another batch.
  if target<=tip:time.sleep(2);continue
  child=subprocess.Popen(['python3',str(root/'tools/service-integration/run-continuous-service.py'),'indexer','--run'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  for line in child.stdout:
   sys.stdout.write(line);sys.stdout.flush();v=json.loads(line)
   if v.get('blockNumber',0)>=target:child.send_signal(signal.SIGTERM);break
  _,err=child.communicate(timeout=65);code=child.returncode;child=None
  if code!=0:
   failures+=1;print('READ_ONLY_INDEXER_RETRY',failures,err,flush=True)
   if failures>=6:raise SystemExit(code)
   time.sleep(min(60,failures*10))
  else:failures=0
except KeyboardInterrupt:
 if child is not None:child.send_signal(signal.SIGTERM);child.wait(timeout=65)
