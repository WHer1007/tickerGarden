import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const contracts=path.join(root,'contracts'),dir=path.join(root,'.codex_tmp/locker-runtime');
fs.mkdirSync(dir,{recursive:true});
const fields={src:contracts+'/src/v1',test:contracts+'/test/v1',script:contracts+'/script/v1',out:dir+'/out',cache_path:dir+'/cache'};
const mappings=fs.readFileSync(contracts+'/remappings.txt','utf8').trim().split('\n').map(l=>{const [prefix,target]=l.split('=');return prefix+'='+path.resolve(contracts,target)+'/';});
const config='[profile.v1]\n'+Object.entries(fields).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n'+
 `libs=[${JSON.stringify(contracts+'/lib')}]\nremappings=${JSON.stringify(mappings)}\nsolc_version="0.8.26"\nevm_version="cancun"\noptimizer=true\noptimizer_runs=200\nbytecode_hash="none"\ncbor_metadata=false\nfs_permissions=[{access="read-write",path=${JSON.stringify(dir)}}]\n`;
fs.writeFileSync(dir+'/foundry.toml',config);
const result=spawnSync(process.env.FOUNDRY_FORGE||path.join(os.homedir(),'.foundry/bin/forge'),['script',contracts+'/test-support/ExportLockerRuntime.sol:ExportLockerRuntimeScript','--config-path',dir+'/foundry.toml','--sig','run()'],{cwd:contracts,env:{...process.env,FOUNDRY_PROFILE:'v1',TG_LOCKER_EXPORT_DIR:dir},stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
