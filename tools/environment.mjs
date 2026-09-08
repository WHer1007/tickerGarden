import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const policies={
 test:{chain:'46630',epoch:'604800',snipe:'5',phantom:'168000000000000000',graduation:'420000000000000000'},
 master:{chain:'4663',epoch:'604800',snipe:'5',phantom:'1680000000000000000',graduation:'4200000000000000000'},
};
export function currentBranch(cwd=root){return execFileSync('git',['branch','--show-current'],{cwd,encoding:'utf8'}).trim();}
export function validateEnvironment(profile,env,branch){
 const p=policies[profile];if(!p)throw Error('Environment must be test or master');
 if(Object.keys(env).some(k=>/^VITE_.*(JWT|SECRET|PASSWORD|API_KEY)/i.test(k)))throw Error('Secret-looking variable must not use the public VITE prefix');
 if(branch!==profile && !(profile==='test'&&branch.startsWith('codex/')))throw Error(`Branch ${branch||'detached HEAD'} cannot use ${profile} configuration`);
 const expected={TG_PROFILE:profile,TG_CHAIN_ID:p.chain,VITE_V1_CHAIN_ID:p.chain,V1_EXPECTED_CHAIN_ID:p.chain,
 TG_EXPECTED_EPOCH_SECONDS:p.epoch,TG_EXPECTED_ANTI_SNIPE_SECONDS:p.snipe,TG_EXPECTED_ALLOCATION_LOCK_SECONDS:'86400',TG_EXPECTED_POSITION_LOCK_SECONDS:'86400',TG_EXPECTED_UNPAUSE_SECONDS:'86400',TG_EXPECTED_RAW_EXIT_SECONDS:profile==='test'?'604800':'not-implemented',
 V1_NATIVE_PHANTOM_WEI:p.phantom,V1_NATIVE_GRADUATION_WEI:p.graduation,V1_FINALITY_DELAY_SECONDS:'600',V1_FINALITY_DELAY_BLOCKS:'2',V1_ROOT_PUBLICATION_WINDOW:'86400',V1_ROOT_REVIEW_DELAY:'3600',V1_CLAIM_WINDOW:'2592000'};
 for(const [key,value] of Object.entries(expected))if(env[key]!==value)throw Error(`Wrong ${profile} parameter: ${key}`);
 if(env.TG_RPC_CU_PER_SECOND&&(!/^\d+$/.test(env.TG_RPC_CU_PER_SECOND)||Number(env.TG_RPC_CU_PER_SECOND)<1||Number(env.TG_RPC_CU_PER_SECOND)>10000))throw Error('RPC CU budget must be between 1 and 10000 per second');
 if(profile==='test'&&(env.TG_EVENT_READ_MODE!=='on-demand'||env.TG_EVENT_START_POLICY!=='latest-on-first-request'))throw Error('Test environment must use on-demand events from the latest block');
 if(profile==='master'){
  if(env.VITE_INTEGRATION_BOOTSTRAP)throw Error('Master cannot use test integration bootstrap');
  if(Object.entries(env).some(([k,v])=>/^(VITE_|V1_|TG_)/.test(k)&&/(r6-fast|f72a2cdf|robinhood-testnet|arbitrum-sepolia)/i.test(v)))throw Error('Test release found in master configuration');
 }
 return env;
}
export function readProjectEnv(profile=process.env.TG_PROFILE||currentBranch(),options={}){
 const directory=options.root??root,branch=options.branch??currentBranch(directory);
 if(profile.startsWith('codex/'))profile='test';
 if(!policies[profile])throw Error('Select test or master explicitly');
 const file=path.join(directory,`.env.${profile}.local`);
 if(!fs.existsSync(file))throw Error(`Create ${path.basename(file)} from config/${profile}.env.example`);
 if(fs.statSync(file).mode&0o077)throw Error(`${path.basename(file)} must have mode 0600`);
 return validateEnvironment(profile,parseEnv(fs.readFileSync(file,'utf8')),branch);
}
export function serviceEnvironment(values,service,inherited=process.env){
 // Inherit only host/toolchain variables. Credentials from another shell/profile
 // cannot override the selected file or reach the Vite process.
 const env=Object.fromEntries(Object.entries(inherited).filter(([k])=>/^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_.*|TERM|COLORTERM|SSH_AUTH_SOCK|GOPATH|GOCACHE|GOMODCACHE|GOROOT|FOUNDRY_FORGE|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/.test(k)));
 for(const [k,v] of Object.entries(values)){
  if(service==='web'?k.startsWith('VITE_'):service==='content-worker'?k.startsWith('TG_CONTENT_')||k.startsWith('PINATA_')||['TG_ENV','TG_CHAIN_ID'].includes(k):service==='gateway'?k.startsWith('RH46630_')||k==='TG_GATEWAY_CONFIG_JSON'||k==='TG_RPC_CU_PER_SECOND':service==='tooling'?true:k.startsWith('TG_')&&!k.startsWith('TG_CONTENT_'))env[k]=v;
 }
 if(['api','tooling'].includes(service))for(const k of ['TG_MIGRATION_DATABASE_URL','TG_INDEXER_DATABASE_URL','TG_PUBLISHER_DATABASE_URL','TG_DISCOVERY_DATABASE_URL','TG_PROJECTION_DATABASE_URL','TG_EVENT_DATABASE_URL','TG_ACTIVITY_DATABASE_URL','TG_TRANSACTION_DATABASE_URL','TG_STATUS_DATABASE_URL','TG_RECONCILIATION_DATABASE_URL','TG_CONTENT_DATABASE_URL','TG_CANDIDATE_DATABASE_URL','TG_HOLDER_REPLAY_DATABASE_URL'])if(!env[k]&&values.TG_DATABASE_URL)env[k]=values.TG_DATABASE_URL;
 if(service==='content-worker')env.TG_CONTENT_DATABASE_URL=values.TG_CONTENT_DATABASE_URL||values.TG_DATABASE_URL;
 if(['api','tooling'].includes(service))for(const k of ['TG_STATUS_RPC_URL','TG_CANDIDATE_RPC_URL'])if(!env[k]&&values.TG_RPC_URL)env[k]=values.TG_RPC_URL;
 for(const [k,v]of Object.entries(env))if(/^(deployments|outputs)\//.test(v)&&/(MANIFEST|BOOTSTRAP_FILE)$/.test(k))env[k]=path.resolve(root,v);
 env.TG_PROFILE=values.TG_PROFILE;return env;
}
export function checkSource(values,directory=root){
 const file=path.join(directory,'contracts/src/v1/modules/TreasuryDistributorV1.sol');
 const days=Number(values.TG_EXPECTED_EPOCH_SECONDS)/86400;
 if(!fs.readFileSync(file,'utf8').includes(`EPOCH_DURATION = ${days} days`))throw Error('Treasury epoch differs from the selected branch profile; changing env cannot change compiled contracts');
 const anti=fs.existsSync(path.join(directory,'contracts/src/v1/libraries/TickerGardenAntiSnipe.sol'))?'TickerGardenAntiSnipe.sol':'PonsAntiSnipe.sol';
 if(!fs.readFileSync(path.join(directory,'contracts/src/v1/libraries',anti),'utf8').includes(`SNIPE_TAX_SECONDS = ${values.TG_EXPECTED_ANTI_SNIPE_SECONDS}`))throw Error('Anti-snipe policy differs from the selected branch');
 const clocks=[['shared/AllocationManagerIncreases.sol','MINIMUM_LOCK = 24 hours'],['shared/MemeStockGaugePendingPositions.sol','MINIMUM_POSITION_LOCK = 24 hours'],['shared/DelayedUnpause.sol','UNPAUSE_STATE_DELAY = 1 days']];
 const rawExit=path.join(directory,'contracts/src/v1/shared/ProtocolFeeVaultRewardSettlement.sol');
 if(values.TG_PROFILE==='test'&&!fs.readFileSync(rawExit,'utf8').includes('RAW_EXIT_DELAY = 7 days'))throw Error('Raw exit clock drift');
 if(values.TG_PROFILE==='master'&&fs.existsSync(rawExit))throw Error('Master acquired raw-exit implementation; review its policy before updating the profile');
 for(const [f,needle]of clocks)if(!fs.readFileSync(path.join(directory,'contracts/src/v1',f),'utf8').includes(needle))throw Error(`Unexpected shortened contract clock: ${f}`);
 if(values.TG_PROFILE==='test'){
  const file=path.join(directory,'apps/web/public',values.VITE_INTEGRATION_BOOTSTRAP||'');
  const b=JSON.parse(fs.readFileSync(file,'utf8'));
  if(b.chainId!==Number(values.TG_CHAIN_ID)||b.releaseId!==values.V1_RELEASE_ID||b.factory!==values.VITE_V1_FACTORY_ADDRESS)throw Error('Test release/bootstrap identity mismatch');
  const native=b.configs.find(c=>c.kind==='quote'&&c.values.quoteAsset==='0x0000000000000000000000000000000000000000');
  if(native?.values.phantomQuote!==values.V1_NATIVE_PHANTOM_WEI||native?.values.graduationThreshold!==values.V1_NATIVE_GRADUATION_WEI)throw Error('Test economics differ from the saved deployment; env edits do not update chain state');
 }
}
async function main(){
 const [action,requested,service,...args]=process.argv.slice(2);const profile=requested==='auto'?currentBranch():requested;const values=readProjectEnv(profile);checkSource(values);
 if(action==='check'){console.log(JSON.stringify({profile,branch:currentBranch(),chain:values.TG_CHAIN_ID,graduationWei:values.V1_NATIVE_GRADUATION_WEI,epochSeconds:values.TG_EXPECTED_EPOCH_SECONDS,configured:values.TG_RUNTIME_CONFIGURED==='true',sourceChecks:'passed'}));return;}
 if(action!=='run'||!['web','api','content-worker','gateway','tooling'].includes(service))throw Error('Usage: node tools/environment.mjs check <test|master> | run <test|master> <web|api|content-worker|tooling> [args]');
 if(values.TG_RUNTIME_CONFIGURED!=='true')throw Error('This environment has no configured deployment/runtime. Fill the selected file before starting.');
 let command,commandArgs,cwd;
 if(service==='web'){command=process.execPath;commandArgs=['node_modules/vite/bin/vite.js',...(args.length?args:['--host','127.0.0.1','--port',values.TG_WEB_PORT||'5178','--strictPort'])];cwd=path.join(root,'apps/web');}
 else if(service==='gateway'){command=process.execPath;commandArgs=['tools/service-integration/rh-read-cache.mjs'];cwd=root;}
 else if(service==='tooling'){[command,...commandArgs]=args;cwd=root;if(!command)throw Error('Missing tooling command');}
 else {command='go';commandArgs=['run',`./cmd/${service}`,...(service==='content-worker'&&!args.length?['--run']:args)];cwd=path.join(root,'services/backend-go');}
 const child=spawn(command,commandArgs,{cwd,env:serviceEnvironment(values,service),stdio:'inherit'});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.on('error',()=>{console.error('Could not start configured service');process.exitCode=1;});child.on('exit',(code)=>{process.exitCode=code??1;});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
