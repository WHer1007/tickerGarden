from pathlib import Path
import json,hashlib,time,shutil
root=Path(__file__).resolve().parents[1];r=root/'.codex_tmp/r6-fast-test';out=root/'outputs/reviews/r6-fast-test-2026-09-06'
strict=json.loads((out/'contracts-strict-final.json').read_text());rows=[(suite,name,t) for suite,s in strict.items()for name,t in s['test_results'].items()]
assert len(rows)==827 and all(t['status']=='Success'for _,_,t in rows)
fork=r/'outputs/reviews/r6-fast-test-2026-09-06/arbitrum-fork-retry.log'
assert '1 tests passed, 0 failed' in fork.read_text()
pin=json.loads((fork.parent/'arbitrum-fresh-pin.json').read_text());assert pin['exitCode']==0
preview=json.loads((r/'deployments/manifests/arbitrum-sepolia-421614.v1.preview.json').read_text())
assert preview['releaseId']=='0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f'
def h(p):return '0x'+hashlib.sha256(p.read_bytes()).hexdigest()
summary={'status':'VERIFIED_TEST_ONLY_CANDIDATE','chainId':421614,'productionTargetChainId':4663,'productionReady':False,'releaseId':preview['releaseId'],'tests':len(rows),'failures':0,'fork':pin,'sourceClockEvidence':json.loads((out/'l2-clock-evidence.json').read_text()),'artifacts':[]}
for p in sorted((r/'contracts/src/v1').rglob('*.sol')):summary['artifacts'].append({'path':str(p.relative_to(r)),'sha256':h(p)})
(r/'deployments/evidence/v1-r6-fast-test-validation.json').write_text(json.dumps(summary,indent=2)+'\n')
now=int(time.time())
cert={'schemaVersion':1,'status':'VERIFIED','executionSpecId':'V1-EXEC-11','chainId':421614,'deployer':preview['deployer'],'releaseId':preview['releaseId'],'payloadHash':preview['payloadHash'],'verifiedAt':now-30,'expiresAt':now+7200,'scope':'ARBITRUM_SEPOLIA_R6_FAST_TEST_ONLY','productionTargetChainId':4663,'productionReady':False,'notes':['User authorized isolated accelerated test release; RH production broadcast excluded.','827 strict ordinary contract tests and actual v4 dependency Fork passed. Local-time/finality mocks are not public natural clock evidence.','L2 source clock independently matched canonical RPC heights/hashes on Arbitrum Sepolia and RH.','R5 remains unchanged; current candidate includes short periods and an independent 1H TWAB schema.'], 'files':[]}
for field,name in [('executionManifestSha256','v1_execution_manifest.json'),('productArtifactManifestSha256','v1_product_artifact_manifest.json'),('compiledInterfaceManifestSha256','v1_compiled_interface_manifest.json')]:cert[field]=h(r/'spec'/name)
for p in [r/'deployments/evidence/v1-r6-fast-test-validation.json',r/'deployments/manifests/arbitrum-sepolia-421614.v1.preview.json',fork]:cert['files'].append({'path':str(p.relative_to(r)),'sha256':h(p)})
(r/'deployments/evidence/v1-current-release.json').write_text(json.dumps(cert,indent=2)+'\n')
shutil.copyfile(fork,r/'outputs/reviews/arbitrum-wallet-deployment/receiver-fix-fork.log')
shutil.copyfile(fork,out/'arbitrum-fork-final.log');shutil.copyfile(fork.parent/'arbitrum-fresh-pin.json',out/'arbitrum-fork-final-pin.json');shutil.copyfile(r/'deployments/evidence/v1-r6-fast-test-validation.json',out/'validation.json')
print(json.dumps({'tests':827,'fork':1,'releaseId':preview['releaseId'],'productionReady':False,'expiresAt':cert['expiresAt']}))
