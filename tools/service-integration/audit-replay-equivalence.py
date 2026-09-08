"""Compare original and optimized fixed-range replay, excluding local audit times."""
import pathlib,json,subprocess,hashlib,datetime
root=pathlib.Path(__file__).resolve().parents[2];p=root/'outputs/reviews/continuous-service-2026-09-07'
urls=[json.loads((p/n).read_text())['url'] for n in ['database.json','benchmark-database.json']]
assert all('@127.0.0.1:' in u for u in urls)
tables=['projection_checkpoints','projection_inputs','projection_rows','projection_observation_batches','projection_block_observations','principal_checkpoints','reconciliation_runs','reconciliation_probes','user_activity_blocks','user_activity_records']
excluded={'projection_checkpoints':'updated_at','principal_checkpoints':'created_at','user_activity_blocks':'indexed_at'}
results=[]
for t in tables:
 values=[];expression='to_jsonb(t)'+("-'"+excluded[t]+"'" if t in excluded else '')
 for u in urls:
  q=f"SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]'::jsonb)::text FROM (SELECT {expression} AS v FROM tickergarden.{t} t) x"
  r=subprocess.run(['psql',u,'-X','-At','-v','ON_ERROR_STOP=1','-c',q],check=True,capture_output=True,text=True);values.append(r.stdout)
 assert values[0]==values[1],t+' differs'
 results.append({'table':t,'rows':len(json.loads(values[0])),'sha256':hashlib.sha256(values[0].encode()).hexdigest(),'equal':True})
(p/'replay-equivalence.json').write_text(json.dumps({'status':'PASS_EXACT_PERSISTED_DATA','scope':'same four canonical blocks 306128256..306128259','excludedLocalMetadata':excluded,'tables':results,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n');print('PASS: 10 derived tables match; only local audit timestamps excluded.')
