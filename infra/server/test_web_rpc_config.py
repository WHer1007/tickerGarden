import copy,unittest
from web_rpc_config import web_rpc_projection
class WebRpcConfigTest(unittest.TestCase):
 def fixture(self):
  route={'https://tickergarden-bsc-read-api.vercel.app':'http://172.18.0.1:8211'}
  web={'kind':'web','environment':'production','transport':route,'env':{'TG_BSC_WEB_RPC_URL':'https://bsc.quiknode.pro/redacted','TG_RPC_BUDGET_TOKEN':'r'*40}}
  read={'transport':route,'bscProfile':{'chainId':56,'backend':{'schema':'tickergarden_bsc','environment':'production','runtime':{'TG_RPC_CONTROL_ENABLED':'true','TG_RPC_BUDGET_TOKEN':'b'*40,'TG_CANDIDATE_ACCESS_TOKEN':'a'*40}}}}
  return {'services':{'web':web,'bsc-read':read,'test-web':{'kind':'web','environment':'test','env':{'TG_BSC_WEB_RPC_URL':'https://test.example'}}}}
 def test_projection_keeps_canonical_input_and_test_environment_unchanged(self):
  c=self.fixture();before=copy.deepcopy(c);out=web_rpc_projection(c)
  self.assertEqual(c,before);self.assertEqual(c['services']['test-web'],out['services']['test-web'])
  self.assertEqual(out['services']['web']['env']['TG_BSC_RPC_BUDGET_TOKEN'],'b'*40)
  self.assertEqual(out['services']['web']['env']['TG_RPC_BUDGET_TOKEN'],'r'*40)
 def test_wrong_identity_routing_credentials_fail_closed(self):
  for kind in ['chain','credentials','routing','fallback']:
   c=self.fixture();w=c['services']['web'];r=c['services']['bsc-read']['bscProfile']
   if kind=='chain':r['chainId']=4663
   if kind=='credentials':r['backend']['runtime']['TG_RPC_BUDGET_TOKEN']='r'*40
   if kind=='routing':w['transportOverrides']={'https://tickergarden-bsc-read-api.vercel.app':'http://172.18.0.1:8300'}
   if kind=='fallback':w['env']['TG_BSC_WEB_RPC_FALLBACK_URL']='https://fallback.example'
   with self.assertRaises(AssertionError):web_rpc_projection(c)
if __name__=='__main__':unittest.main()
