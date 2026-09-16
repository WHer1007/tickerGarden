"""Create a dedicated loopback-only PostgreSQL instance for public read integration."""
import json,os,pathlib,socket,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'outputs/reviews/continuous-service-2026-09-07'
out.mkdir(parents=True,exist_ok=True)
p=out/'database.json'
if p.exists(): raise SystemExit('Existing DB metadata: inspect/resume, do not recreate')
data=pathlib.Path(tempfile.mkdtemp(prefix='tg-continuous-',dir='/tmp'))
def run(args): return subprocess.run(args,check=True,capture_output=True,text=True).stdout
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
run(['initdb','-D',str(data/'db'),'-A','trust','-U','tickergarden','--no-locale','-E','UTF8'])
run(['pg_ctl','-D',str(data/'db'),'-l',str(data/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port} -k {data}','-w','start'])
url=f'postgres://tickergarden@127.0.0.1:{port}/service_live?sslmode=disable'
run(['createdb','-h','127.0.0.1','-p',str(port),'-U','tickergarden','service_live'])
p.write_text(json.dumps({'directory':str(data),'port':port,'url':url},indent=2))
r=subprocess.run([str(root/'services/backend-go/bin/migrate'),'up'],env=dict(os.environ,TG_MIGRATION_DATABASE_URL=url),check=True,capture_output=True,text=True)
(out/'migration.json').write_text(r.stdout)
# Distinct local test identities, not production least-privilege credentials.
run(['psql',url,'-v','ON_ERROR_STOP=1','-c','CREATE ROLE svc_candidate LOGIN SUPERUSER; CREATE ROLE svc_reviewer LOGIN SUPERUSER; CREATE ROLE svc_publisher LOGIN SUPERUSER;'])
print('ISOLATED_DATABASE_READY')
