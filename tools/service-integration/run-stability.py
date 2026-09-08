"""Local-only service test runner with its own PostgreSQL and service binaries.
Never connects to existing service DBs or public RPC; never loads signing keys.
"""
import argparse,json,os,pathlib,socket,subprocess,tempfile,time
root=pathlib.Path(__file__).resolve().parents[2]
a=argparse.ArgumentParser();a.add_argument('--test-pattern',default='TestLocalServiceSustainedRecovery|TestSevenDayHistoryCapacity');a.add_argument('--label',default='stability');args=a.parse_args()
base=root/'outputs/reviews/backend-stability-capacity-2026-09-06';base.mkdir(exist_ok=True,parents=True)
out=pathlib.Path(tempfile.mkdtemp(prefix=args.label+'-',dir=base));d=pathlib.Path(tempfile.mkdtemp(prefix='tg-stability-',dir='/tmp'))
def run(cmd,**kw):return subprocess.run(cmd,check=True,capture_output=True,text=True,**kw)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
run(['initdb','-D',str(d/'db'),'-A','trust','-U','tickergarden','--no-locale','-E','UTF8'])
run(['pg_ctl','-D',str(d/'db'),'-l',str(d/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port} -k {d}','-w','start'])
meta={'directory':str(d),'port':port,'evidence':str(out),'testPattern':args.test_pattern,'scope':'Isolated synthetic local RPC and real service/PostgreSQL tests, no public chain writes'};(out/'run.json').write_text(json.dumps(meta,indent=2));print(str(out),flush=True)
try:
 bindir=d/'bin';bindir.mkdir()
 with (out/'build.log').open('w') as log:
  for name in ['indexer','discovery-worker']:
   subprocess.run(['go','build','-o',str(bindir/name),'./cmd/'+name],cwd=root/'services/backend-go',stdout=log,stderr=subprocess.STDOUT,check=True,timeout=180)
 env=dict(os.environ,TG_TEST_DATABASE_URL=f'postgres://tickergarden@127.0.0.1:{port}/postgres?sslmode=disable',TG_TEST_STABILITY='1',TG_TEST_CAPACITY='1',TG_TEST_SERVICE_BIN=str(bindir),TG_TEST_EVIDENCE_DIR=str(out))
 started=time.monotonic()
 with (out/'tests.log').open('w') as log:r=subprocess.run(['go','test','-count=1','-timeout=15m','-v','./integration','-run',args.test_pattern],cwd=root/'services/backend-go',env=env,stdout=log,stderr=subprocess.STDOUT,timeout=930)
 meta.update(exitCode=r.returncode,seconds=time.monotonic()-started)
finally:
 stopped=run(['pg_ctl','-D',str(d/'db'),'-m','fast','-w','stop']);(out/'postgres-stop.log').write_text(stopped.stdout+stopped.stderr);meta['databaseStopped']=True;(out/'run.json').write_text(json.dumps(meta,indent=2))
raise SystemExit(r.returncode)
