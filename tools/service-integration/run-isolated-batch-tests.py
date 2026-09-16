import os,pathlib,socket,subprocess,tempfile,json
root=pathlib.Path(__file__).resolve().parents[2];out=root/'outputs/reviews/formal-clock-service-integration-2026-09-06';d=pathlib.Path(tempfile.mkdtemp(prefix='tg-batch-tests-',dir='/tmp'))
def run(a):return subprocess.run(a,check=True,capture_output=True,text=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
run(['initdb','-D',str(d/'db'),'-A','trust','-U','tickergarden','--no-locale','-E','UTF8'])
run(['pg_ctl','-D',str(d/'db'),'-l',str(d/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port} -k {d}','-w','start'])
try:
 with open(out/'discovery-batch-integration.log','w') as log:r=subprocess.run(['go','test','-race','-count=1','-v','./integration'],cwd=root/'services/backend-go',env=dict(os.environ,TG_TEST_DATABASE_URL=f'postgres://tickergarden@127.0.0.1:{port}/postgres?sslmode=disable'),stdout=log,stderr=subprocess.STDOUT)
 print('integration exit',r.returncode)
finally:run(['pg_ctl','-D',str(d/'db'),'-m','fast','-w','stop'])
raise SystemExit(r.returncode)
