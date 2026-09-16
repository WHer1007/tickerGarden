"""Bounded real public-history replay; no new indexing, signing or publication."""
import json,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parents[2];p=root/'outputs/reviews/continuous-service-2026-09-07'
results=[]
for i in range(24):
 started=time.monotonic();r=subprocess.run(['python3',str(root/'tools/service-integration/run-continuous-service.py'),'event-worker','--once'],capture_output=True,text=True,timeout=90)
 if r.returncode:
  (p/'event-lane-sample-error.log').write_text(r.stderr);print(r.stderr);raise SystemExit(r.returncode)
 v=json.loads(r.stdout);v['wallSeconds']=time.monotonic()-started;results.append(v);(p/'event-lane-sample.json').write_text(json.dumps({'status':'IN_PROGRESS','steps':results},indent=2)+'\n');print(json.dumps(v),flush=True)
 if v.get('blockNumber',0)>=306129107 or v['action']=='idle':break
(p/'event-lane-sample.json').write_text(json.dumps({'status':'BOUNDED_EVENT_REPLAY_COMPLETE','steps':results},indent=2)+'\n')
