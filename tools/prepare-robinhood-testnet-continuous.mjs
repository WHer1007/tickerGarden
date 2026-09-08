import {readProjectEnv} from "./environment.mjs";
import {reviewPath, simulationPath} from "./robinhood-deployment-run.mjs";
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {keccak256, toHex} from '../apps/web/node_modules/viem/_esm/index.js';
import {assertArtifactSourcesCurrent} from './verify-v1-build-inputs.mjs';

const root = new URL('../', import.meta.url).pathname;
const output = root + `${reviewPath}`;
fs.mkdirSync(output, {recursive: true});
const envFile = readProjectEnv();
if (!envFile.ALCHEMY_API_KEY) throw Error('Missing ALCHEMY_API_KEY');
const rpcUrl = `https://robinhood-testnet.g.alchemy.com/v2/${envFile.ALCHEMY_API_KEY}`;
const rpc = async (method, params) => {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}), signal: AbortSignal.timeout(30_000)});
  const body = await response.json();
  if (!response.ok || body.error) throw Error(`RPC failed: ${method}`);
  return body.result;
};
if (BigInt(await rpc('eth_chainId', [])) !== 46630n) throw Error('Wrong chain');
const block = await rpc('eth_getBlockByNumber', ['latest', false]);
const deployer = '0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea';
const treasury = JSON.parse(fs.readFileSync(root + 'deployments/manifests/robinhood-testnet-46630.test-treasury.json'));
if (treasury.status !== 'DEPLOYED_VERIFIED' || treasury.owner.toLowerCase() !== deployer.toLowerCase()) throw Error('Treasury record mismatch');
const treasuryCode = await rpc('eth_getCode', [treasury.address, block.number]);
if (treasuryCode === '0x' || keccak256(treasuryCode) !== treasury.runtimeCodeHash) throw Error('Treasury code drift');

const plan = JSON.parse(fs.readFileSync(root + 'deployments/manifests/robinhood-testnet-46630.v1.plan.json'));
const dependencies = [];
for (const dependency of plan.externalDependencies) {
  const code = await rpc('eth_getCode', [dependency.address, block.number]);
  const codeHash = keccak256(code);
  if (code === '0x' || codeHash !== dependency.runtimeCodeHash) throw Error(`Dependency drift: ${dependency.name}`);
  dependencies.push({name: dependency.name, address: dependency.address, codeHash, codeBytes: (code.length - 2) / 2});
}
const dependency = (name) => plan.externalDependencies.find((item) => item.name === name);
const callAddress = async (address, selector) => '0x' + (await rpc('eth_call', [{to: address, data: selector}, block.number])).slice(-40);
const pm = dependency('POSITION_MANAGER');
const pmPoolManager = await callAddress(pm.address, keccak256(toHex('poolManager()')).slice(0, 10));
const pmPermit2 = await callAddress(pm.address, keccak256(toHex('permit2()')).slice(0, 10));
if (pmPoolManager.toLowerCase() !== dependency('POOL_MANAGER').address.toLowerCase()) throw Error('PositionManager PoolManager mismatch');
if (pmPermit2.toLowerCase() !== dependency('PERMIT2').address.toLowerCase()) throw Error('PositionManager Permit2 mismatch');

const product = fs.readFileSync(root + 'spec/v1_product_artifact_manifest.json');
const releaseId = keccak256(toHex(`TickerGarden:RobinhoodTestnet:atomicNativeBuy:continuous24h:antisnipe5s:20260908:${keccak256(product)}:${block.hash}`));
const feePolicyId = keccak256(toHex('TICKERGARDEN_V1_FEE_POLICY_40_30_30'));
const values = {
  V1_EXPECTED_CHAIN_ID: '46630',
  V1_EXPECTED_DEPLOYER: deployer,
  V1_INITIAL_ADMIN: deployer,
  V1_PLATFORM_TREASURY: treasury.address,
  V1_PLATFORM_TREASURY_CODEHASH: treasury.runtimeCodeHash,
  V1_ROOT_SERVICE_TREASURY: deployer,
  V1_RELEASE_ID: releaseId,
  V1_ROOT_SERVICE_FEE_ASSET: '0x0000000000000000000000000000000000000000',
  V1_ROOT_SERVICE_FEE_AMOUNT: '1000000000000000',
  V1_FINALITY_DELAY_SECONDS: envFile.V1_FINALITY_DELAY_SECONDS,
  V1_FINALITY_DELAY_BLOCKS: envFile.V1_FINALITY_DELAY_BLOCKS,
  V1_ROOT_PUBLICATION_WINDOW: envFile.V1_ROOT_PUBLICATION_WINDOW,
  V1_ROOT_REVIEW_DELAY: envFile.V1_ROOT_REVIEW_DELAY,
  V1_CLAIM_WINDOW: envFile.V1_CLAIM_WINDOW,
  V1_FEE_POLICY_ID: feePolicyId,
  V1_POOL_MANAGER: dependency('POOL_MANAGER').address,
  V1_POOL_MANAGER_CODEHASH: dependency('POOL_MANAGER').runtimeCodeHash,
  V1_POSITION_MANAGER: dependency('POSITION_MANAGER').address,
  V1_POSITION_MANAGER_CODEHASH: dependency('POSITION_MANAGER').runtimeCodeHash,
  V1_PERMIT2: dependency('PERMIT2').address,
  V1_PERMIT2_CODEHASH: dependency('PERMIT2').runtimeCodeHash,
  V1_SWAP_ROUTER: dependency('UNIVERSAL_ROUTER').address,
  V1_SWAP_ROUTER_CODEHASH: dependency('UNIVERSAL_ROUTER').runtimeCodeHash,
  V1_NATIVE_QUOTE_POOL_FEE: '10000',
  V1_NATIVE_QUOTE_TICK_SPACING: '200',
  V1_QUOTER: dependency('V4_QUOTER').address,
  V1_QUOTER_CODEHASH: dependency('V4_QUOTER').runtimeCodeHash,
};
const script = 'DeployV1RobinhoodTestnetContinuousHolders';
const artifact = JSON.parse(fs.readFileSync(root + `contracts/out-v1/${script}.s.sol/${script}.json`));
assertArtifactSourcesCurrent(artifact, root + 'contracts', script);
const childEnv = {...process.env, ...values};
delete childEnv.DEPLOYER_PRIVATE_KEY;
const result = spawnSync(process.execPath, ['tools/run-forge.mjs', 'script', `script/v1/${script}.s.sol:${script}`, '--sig', 'preview()', '--rpc-url', rpcUrl, '--sender', deployer, '--non-interactive', '-vv'], {cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024});
const log = (result.stdout ?? '') + (result.stderr ?? '');
fs.writeFileSync(output + '/preview.log', log.split(rpcUrl).join('[ROBINHOOD_TESTNET_RPC]'));
if (result.status !== 0) throw Error('Preview failed; see sanitized preview.log');
const take = (regex) => { const match = log.match(regex); if (!match) throw Error(`Missing preview field: ${regex}`); return match[1]; };
const preview = {
  status: 'PREDICTED_NOT_DEPLOYED', chainId: 46630, releaseId,
  orchestrator: take(/\borchestrator (0x[\da-fA-F]{40})/),
  factory: take(/\bfactory (0x[\da-fA-F]{40})/),
  hook: take(/\bhook (0x[\da-fA-F]{40})/),
  executor: take(/\bexecutor (0x[\da-fA-F]{40})/),
  helper: take(/\bhelper (0x[\da-fA-F]{40})/),
  payloadHash: take(/payload hash\s+(0x[\da-fA-F]{64})/),
  ordinaryComponents: take(/ordinaryComponents: \[([^\]]+)\]/).split(',').map((value) => value.trim()),
};
if (preview.ordinaryComponents.length !== 16 || (BigInt(preview.hook) & 0x3fffn) !== 0x2044n) throw Error('Invalid deployment graph');
values.V1_EXPECTED_ORCHESTRATOR = preview.orchestrator;
for (const address of [preview.orchestrator, preview.factory, preview.hook, preview.executor, preview.helper, ...preview.ordinaryComponents]) {
  if (await rpc('eth_getCode', [address, block.number]) !== '0x') throw Error(`Candidate address occupied: ${address}`);
}
const [balance, nonce, gasPrice] = await Promise.all([
  rpc('eth_getBalance', [deployer, block.number]),
  rpc('eth_getTransactionCount', [deployer, block.number]),
  rpc('eth_gasPrice', []),
]);
fs.writeFileSync(output + '/candidate.public.env', Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', {mode: 0o600});
fs.writeFileSync(output + '/candidate.preview.json', JSON.stringify(preview, null, 2) + '\n');
fs.writeFileSync(output + '/chain-preflight.json', JSON.stringify({
  schemaVersion: 1, status: 'READ_ONLY_PREFLIGHT_PASSED_NOT_BROADCAST', chainId: 46630,
  dependencyProvenance: plan.dependencyProvenance, observedAt: new Date().toISOString(),
  block: {number: String(BigInt(block.number)), hash: block.hash, timestamp: String(BigInt(block.timestamp))},
  deployer, nonce: String(BigInt(nonce)), balanceWei: String(BigInt(balance)), gasPriceWei: String(BigInt(gasPrice)),
  releaseId, treasury: {address: treasury.address, codeHash: treasury.runtimeCodeHash}, dependencies,
  sourceHashes: {
    executionManifestSha256: '0x' + createHash('sha256').update(fs.readFileSync(root + 'spec/v1_execution_manifest.json')).digest('hex'),
    productArtifactManifestSha256: '0x' + createHash('sha256').update(product).digest('hex'),
  },
}, null, 2) + '\n');
console.log(JSON.stringify({status: 'PREVIEW_PASSED_NOT_BROADCAST', chainId: 46630, releaseId, orchestrator: preview.orchestrator, factory: preview.factory, balanceWei: String(BigInt(balance)), nonce: String(BigInt(nonce)), output}));
