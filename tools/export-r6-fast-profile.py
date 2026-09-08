"""Export the isolated profile as a reviewable overlay plus deployment evidence. No secrets."""
from pathlib import Path
import json,hashlib,difflib,shutil
root=Path(__file__).resolve().parents[1];r=root/'.codex_tmp/r6-fast-test';out=root/'deployments/test-profiles/r6-fast';out.mkdir(parents=True,exist_ok=True)
p=json.loads((r/'deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json').read_text());assert p['releaseId']=='0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f'
release=root/'deployments/releases'/p['releaseId'];release.mkdir(parents=True,exist_ok=True)
for name in ['deployed','activation','transactions','preview']:
 source=r/f'deployments/manifests/arbitrum-sepolia-421614.v1.{name}.json'
 if source.exists():shutil.copyfile(source,release/f'arbitrum-sepolia-421614.v1.{name}.json')
for source in (r/'deployments/releases'/p['releaseId']).glob('*.json'):shutil.copyfile(source,release/source.name)
shutil.copyfile(r/'deployments/config/arbitrum-sepolia.public.env',out/'arbitrum-sepolia.r6-fast.public.env')
shutil.copyfile(root/'outputs/reviews/r6-fast-test-2026-09-06/profile.json',out/'profile.json')
keys={'CHAIN_ID':421614,'FACTORY_ADDRESS':p['factory'],'LAUNCH_ROUTER_ADDRESS':p['ordinaryComponents'][9],'ALLOCATION_MANAGER_ADDRESS':p['ordinaryComponents'][12],'PROTOCOL_FEE_VAULT_ADDRESS':p['ordinaryComponents'][15],'CREATOR_REVENUE_REGISTRY_ADDRESS':p['ordinaryComponents'][11],'TREASURY_DISTRIBUTOR_ADDRESS':p['ordinaryComponents'][14]}
(out/'frontend-public.env').write_text('# R6 FAST TEST ONLY. Requires a matching R6 Read API/indexer; never mix with R5.\n'+'\n'.join('VITE_V1_'+k+'='+str(v)for k,v in keys.items())+'\n')
paths=[]
for name in ['contracts/src/v1','contracts/script/v1','contracts/test/v1','spec','services','apps/web/src','apps/web/tests','tools','deployments/src','deployments/test']:
 for f in (r/name).rglob('*'):
  if not f.is_file()or any(x in {'node_modules','dist','__pycache__','testdata'}for x in f.parts):continue
  if f.suffix not in {'.sol','.ts','.py','.mjs','.go','.json'}:continue
  paths.append(f)
# Include independently generated Go treasury fixtures and event catalog explicitly.
paths.extend([r/'contracts/foundry.toml',r/'services/backend-go/internal/treasury/testdata/golden.json'])
patch=[];index=[]
for f in sorted(set(paths)):
 rel=f.relative_to(r);base=root/rel;new=f.read_bytes();old=base.read_bytes()if base.exists()else b''
 if old==new:continue
 before=hashlib.sha256(old).hexdigest()if base.exists()else None;after=hashlib.sha256(new).hexdigest()
 index.append({'path':str(rel),'baseSHA256':before,'r6SHA256':after})
 target=out/'overlay'/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(new)
 patch.extend(difflib.unified_diff(old.decode().splitlines(True),new.decode().splitlines(True),fromfile='a/'+str(rel)if base.exists()else'/dev/null',tofile='b/'+str(rel)))
(out/'source-overlay.patch').write_text(''.join(patch));(out/'overlay-index.json').write_text(json.dumps({'releaseId':p['releaseId'],'purpose':'R6 fast only; apply only to a fresh isolated matching base snapshot; never to production checkout','files':index},indent=2)+'\n')
(out/'README.md').write_text('''# R6 快速测试发布包\n\n只用于 Arbitrum Sepolia 421614；不是生产发布包。R5 默认manifest和生产源码保持原样。\n\n- `overlay/`：本轮相对主目录变更的完整文件，可直接审阅。\n- `source-overlay.patch` / `overlay-index.json`：精确差异和base/new SHA256。只在新隔离快照且base hash匹配时应用，不要覆盖主目录。\n- `profile.json`：初始短周期参数；后续L2区块及schema联动修复以overlay和链上核验为准。\n- `arbitrum-sepolia.r6-fast.public.env`：公开部署参数，没有私钥。\n- `frontend-public.env`：新地址，需匹配R6索引/API；不能连接R5数据服务。\n\n实际运行快照在 `.codex_tmp/r6-fast-test`，独立journal在该快照的outputs/deployments/releases内。重建源码不代表可以删除journal或重放交易。正式证据与报告见主目录 `outputs/reviews/r6-fast-test-2026-09-06`，发布manifest见 `deployments/releases/'''+p['releaseId']+'''`。\n''')
print(json.dumps({'release':str(release),'overlayFiles':len(index),'productionDefaultManifestChanged':False}))
