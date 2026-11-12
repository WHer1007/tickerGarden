import copy,json,unittest
from worker_config import worker_projections
class WorkerConfigTest(unittest.TestCase):
 def config(self):
  policy=json.dumps({'quicknode':{'rps':10,'burst':20,'interactiveReserve':5,'backgroundConcurrency':1,'nonInteractiveConcurrency':2}})
  runtime={'TG_RPC_CONTROL_ENABLED':'true','TG_RPC_BUDGETS_JSON':policy,'TG_RPC_BUDGET_TOKEN':'x'*64}
  profile={'chainId':56,'rpcUrl':'https://fixture.quiknode.pro/redacted','backend':{'schema':'tickergarden_bsc','environment':'production','database':{'pipeline':'postgresql://bsc_pipeline:fixture@172.18.0.3/tickergarden_bsc'},'runtime':runtime}}
  service={'bscProfile':profile,'transport':{'https://tickergarden-bsc-read-api.vercel.app':'http://172.18.0.1:8211'}}
  return {'services':{'bsc-read':copy.deepcopy(service),'bsc-pipeline':copy.deepcopy(service)},'productionWorkers':{name:{'profilePath':'/opt/tickergarden-bsc/releases/'+name+'/config/service-runtime.json','profile':copy.deepcopy(profile)} for name in ['bsc-display','bsc-relay']}}
 def test_worker_policy_is_derived_and_source_is_not_mutated(self):
  c=self.config();c['productionWorkers']['bsc-display']['profile']['backend']['runtime']={};before=copy.deepcopy(c);rows=worker_projections(c)
  self.assertEqual(len(rows),2);self.assertEqual(c,before)
  for _,profile in rows:self.assertEqual(profile['backend']['runtime']['TG_RPC_CONTROL_ENABLED'],'true')
 def test_drift_and_public_permit_route_are_rejected(self):
  c=self.config();c['services']['bsc-pipeline']['bscProfile']['backend']['runtime']['TG_RPC_BUDGETS_JSON']='{}'
  with self.assertRaises(AssertionError):worker_projections(c)
  c=self.config();c['services']['bsc-read']['transport']={}
  with self.assertRaises(AssertionError):worker_projections(c)
if __name__=='__main__':unittest.main()
