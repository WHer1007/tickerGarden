"""One live R6 market: real durable services and an explicitly separated test signer.
Stops on any command/error or expired publication window; never retries a write blindly.
"""
import json,os,pathlib,subprocess,time,hashlib,datetime,sys,signal
root=pathlib.Path(__file__).resolve().parents[2];r6=root/'.codex_tmp/r6-fast-test';out=root/'outputs/reviews/formal-clock-service-integration-2026-09-06/service-live';statefile=r6/'outputs/reviews/service-live-2026-09-06/results.json';started=time.time()
def state():return json.loads(statefile.read_text())
def status(stage,**kwargs):(out/'lifecycle-status.json').write_text(json.dumps({'stage':stage,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),**kwargs},indent=2))
def wait_until(timestamp,stage):
 while time.time()<timestamp:
  if time.time()-started>4*3600:raise RuntimeError('Bounded lifecycle deadline exceeded')
  status(stage,availableAt=timestamp);time.sleep(min(5,timestamp-time.time()))
def run(name,args,role='svc_candidate',cwd=root):
 status(name);p=subprocess.run(args,cwd=cwd,env=dict(os.environ,SERVICE_DB_ROLE=role),capture_output=True,text=True,timeout=180)
 (out/(name+'.stdout')).write_text(p.stdout);(out/(name+'.stderr')).write_text(p.stderr)
 if p.returncode:raise RuntimeError(name+' failed; preserved stdout/stderr; no automatic write retry')
 return json.loads(p.stdout) if p.stdout.strip().startswith('{') else p.stdout
def svc(name,*args,role='svc_candidate'):return run(name,['python3',str(root/'tools/service-integration/run-service.py'),*map(str,args)],role)
def normalized(x):
 if isinstance(x,dict):return {k:normalized(v) for k,v in x.items()}
 if isinstance(x,list):return [normalized(v) for v in x]
 return x.lower() if isinstance(x,str) and x.startswith('0x') else x
def candidate_worker(job_id,manifest,publication_deadline):
 # Exercise the real supervised queue loop, including its persisted retry and
 # lease policy. It has no signer and cannot publish a transaction.
 limit=min(time.time()+180,publication_deadline-45)
 with open(out/'run-candidate-worker.stdout','w') as log,open(out/'run-candidate-worker.stderr','w') as err:
  worker=subprocess.Popen(['python3',str(root/'tools/service-integration/run-service.py'),'treasury-jobs','--run','--manifest',str(manifest)],cwd=root,env=dict(os.environ,SERVICE_DB_ROLE='svc_candidate'),stdout=log,stderr=err)
  try:
   while time.time()<limit:
    job=svc('candidate-worker-status','treasury-jobs','--status',job_id)
    if job['state']=='succeeded':return job
    if job['state']=='dead' or worker.poll() is not None:raise RuntimeError('Candidate worker stopped or job exhausted its persisted retries')
    time.sleep(2)
   raise RuntimeError('Candidate worker deadline reached; no publication')
  finally:
   if worker.poll() is None:worker.send_signal(signal.SIGTERM)
   worker.wait(timeout=65)
try:
 if '--existing-request' not in sys.argv:
  wait_until(int(state()['window'][1])+602,'WAIT_NATURAL_EPOCH')
  run('request-root',['node','tools/service-live-public.mjs','run','request'],cwd=r6)
 run('independent-reference',['node','--experimental-strip-types','tools/service-integration/independent-reference.mjs'])
 s=state();requestBlock=int(next(t['blockNumber'] for t in s['transactions'] if t['id']==s.get('activeRequestId','service-root-request')));source=int(s['epoch']['sourceBlockNumber']);deadline=int(s['epoch']['publishBy']);db=json.loads((out/'database.json').read_text())['url']
 while True:
  if time.time()>=deadline-45:raise RuntimeError('Insufficient publication window after real finalized indexing; stop without publication')
  q=subprocess.run(['psql',db,'-At','-F',',','-c','SELECT coalesce(j.finalized_number,0),coalesce(d.tip_number,0) FROM tickergarden.chain_journal j JOIN tickergarden.discovery_checkpoints d USING(chain_id) WHERE j.chain_id=421614'],capture_output=True,text=True,check=True)
  finalized,discovered=map(int,q.stdout.strip().split(','))
  if finalized>=requestBlock and discovered>=source:break
  status('WAIT_FINALIZED_JOURNAL_AND_DISCOVERY',requestBlock=requestBlock,sourceBlock=source,finalized=finalized,discovered=discovered,publishBy=deadline);time.sleep(5)
 manifest=out/'manifest.json'
 found=svc('discover-root-request','treasury-jobs','--discover','--manifest',manifest,'--policies',out/'policies.json')
 if found['queued']!=1:raise RuntimeError('Expected exactly one automatically discovered request')
 first=svc('enqueue-duplicate-1','treasury-jobs','--enqueue',out/'request.json','--manifest',manifest)
 second=svc('enqueue-duplicate-2','treasury-jobs','--enqueue',out/'request.json','--manifest',manifest)
 if first!=second:raise RuntimeError('Duplicate request changed job identity')
 job=candidate_worker(first['jobId'],manifest,deadline)
 if job['state']!='succeeded' or not job.get('candidateId'):raise RuntimeError('Candidate worker did not succeed')
 cid=job['candidateId'];(out/'candidate-id.json').write_text(json.dumps({'candidateId':cid,'jobId':first['jobId']},indent=2))
 idle=svc('restart-candidate-worker','treasury-jobs','--once','--manifest',manifest)
 if idle.get('status')!='idle':raise RuntimeError('Restart reprocessed completed candidate')
 exported=svc('export-candidate-input','treasury-review','--export-input',cid,role='svc_reviewer')
 independent=json.loads((out/'independent-input.json').read_text())
 if normalized(exported)!=normalized(independent):raise RuntimeError('Independent input differs from journal-derived input')
 report=svc('history-report-template','treasury-review','--report-template',cid,role='svc_reviewer')
 report.update(historyComplete=True,emptyEpochReviewed=False,method='Independent official-RPC token Transfer scan from creation through committed source, matched byte-for-byte after address normalization against receipt-checked Go journal input; independent TypeScript and Solidity leaf computation.',evidence='independent-history.json SHA256 '+hashlib.sha256((out/'independent-history.json').read_bytes()).hexdigest()+'; independent-input.json and independent-typescript.json; Go finalized continuous journal replay. This is reviewer attestation, not cryptographic receipt-root verification.')
 (out/'history-report.json').write_text(json.dumps(report,indent=2))
 svc('approve-candidate','treasury-review','--candidate',cid,'--decision','approved','--operation-id','0x'+hashlib.sha256(('review:'+cid).encode()).hexdigest(),'--reason','Independent public RPC history and TypeScript result verified against the persistent Go candidate. Test only.','--reference',out/'independent-typescript.json','--history-report',out/'history-report.json','--manifest',manifest,role='svc_reviewer')
 run('publish-reviewed-root',['node','tools/service-reviewed-action.mjs','run','publish'],cwd=r6)
 wait_until(int(state()['epoch']['finalizeAfter'])+2,'WAIT_NATURAL_REVIEW_DELAY')
 run('finalize-reviewed-root',['node','tools/service-reviewed-action.mjs','run','finalize'],cwd=r6)
 for role in ['creator','buyer']:run('claim-api-'+role,['node','tools/service-reviewed-action.mjs','run','claim-'+role],cwd=r6)
 status('LIVE_SERVICE_CLAIM_FLOW_FINISHED',candidateId=cid,jobId=first['jobId'])
except Exception as e:
 status('STOPPED_REQUIRES_INSPECTION',error=str(e));raise
