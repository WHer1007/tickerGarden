import {readProjectEnv} from "./environment.mjs";
import {reviewPath, simulationPath} from "./robinhood-deployment-run.mjs";
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
import {verifyBatch, output as simulationOutput} from './verify-robinhood-testnet-continuous-simulation.mjs';
import {assertArtifactSourcesCurrent} from './verify-v1-build-inputs.mjs';

const root = new URL('../', import.meta.url).pathname;
const preflightDir = root + `${reviewPath}`;
const read = (file) => JSON.parse(fs.readFileSync(file));
const cfg = Object.fromEntries(fs.readFileSync(preflightDir + '/candidate.public.env', 'utf8').split('\n').filter(Boolean).map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const local = readProjectEnv();
if (!local.ALCHEMY_API_KEY) throw Error('Missing ALCHEMY_API_KEY');
const rpcUrl = (process.env.TG_RH_DEPLOYMENT_RUN === 'frontend-independent-2026-09-08' ? 'http://127.0.0.1:18570' : `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`);
const rpc = async (method, params) => {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}), signal: AbortSignal.timeout(30_000)});
  const body = await response.json(); if (!response.ok || body.error) throw Error(`RPC failed: ${method}`); return body.result;
};
const ensure = (ok, message) => { if (!ok) throw Error(message); };
const sha = (file) => '0x' + createHash('sha256').update(fs.readFileSync(root + file)).digest('hex');
const checked = verifyBatch();
const preview = read(preflightDir + '/candidate.preview.json');
const preflight = read(preflightDir + '/chain-preflight.json');
const artifact = read(root + 'contracts/out-v1/DeployV1RobinhoodTestnetContinuousHolders.s.sol/DeployV1RobinhoodTestnetContinuousHolders.json');
assertArtifactSourcesCurrent(artifact, root + 'contracts');
ensure(BigInt(await rpc('eth_chainId', [])) === 46630n, 'Wrong chain');
const block = await rpc('eth_getBlockByNumber', ['latest', false]);
const nonce = BigInt(await rpc('eth_getTransactionCount', [cfg.V1_EXPECTED_DEPLOYER, 'pending']));
ensure(nonce === BigInt(checked.firstNonce), 'Pending nonce changed; regenerate candidate');
for (const dependency of [...preflight.dependencies, {name: 'RobinhoodTestnetTreasury', address: preflight.treasury.address, codeHash: preflight.treasury.codeHash}]) {
  ensure(keccak256(await rpc('eth_getCode', [dependency.address, block.number])) === dependency.codeHash, `Code drift: ${dependency.name}`);
}
for (const address of [preview.orchestrator, preview.factory, preview.hook, preview.executor, preview.helper, ...preview.ordinaryComponents]) {
  ensure(await rpc('eth_getCode', [address, block.number]) === '0x', `Candidate address occupied: ${address}`);
}
const balance = BigInt(await rpc('eth_getBalance', [cfg.V1_EXPECTED_DEPLOYER, block.number]));
ensure(balance >= 20_000_000_000_000_000n, 'Require at least 0.02 test ETH for guarded deployment');

const sourceFiles = [
  'spec/v1_execution_manifest.json',
  'spec/v1_product_artifact_manifest.json',
  'spec/v1_compiled_interface_manifest.json',
  `${reviewPath}/candidate.public.env`,
  `${reviewPath}/candidate.preview.json`,
  `${reviewPath}/chain-preflight.json`,
  `${simulationPath}/unsigned-transactions.json`,
  `${simulationPath}/verification.json`,
  'contracts/script/v1/V1RobinhoodTestnetDeploymentOrchestrator.sol',
  'contracts/script/v1/DeployV1RobinhoodTestnetStaged.s.sol',
  'contracts/script/v1/DeployV1RobinhoodTestnetContinuousHolders.s.sol',
  'tools/verify-robinhood-testnet-continuous-simulation.mjs',
  'tools/simulate-robinhood-testnet-continuous.mjs',
  'tools/send-robinhood-testnet-continuous.mjs',
];
const walk = (directory) => fs.readdirSync(root + directory, {withFileTypes: true}).flatMap((entry) => {
  const relative = path.posix.join(directory, entry.name);
  return entry.isDirectory() ? walk(relative) : entry.isFile() && entry.name.endsWith('.sol') ? [relative] : [];
});
sourceFiles.push(...walk('contracts/src/v1'));
const uniqueFiles = [...new Set(sourceFiles)].sort();
const execution = read(root + 'spec/v1_execution_manifest.json');
const timestamp = Number(BigInt(block.timestamp));
const certificate = {
  schemaVersion: 1,
  status: 'VERIFIED',
  scope: 'ROBINHOOD_TESTNET_WALLET_SNAPSHOT_DEPLOYMENT_ONLY',
  broadcastStatus: 'NOT_BROADCAST',
  productionStatus: 'NOT_PRODUCTION_READY',
  executionSpecId: execution.executionSpecId,
  chainId: 46630,
  deployer: cfg.V1_EXPECTED_DEPLOYER,
  releaseId: checked.releaseId,
  payloadHash: checked.payloadHash,
  verifiedAt: timestamp,
  expiresAt: timestamp + 7200,
  executionManifestSha256: sha('spec/v1_execution_manifest.json'),
  productArtifactManifestSha256: sha('spec/v1_product_artifact_manifest.json'),
  compiledInterfaceManifestSha256: sha('spec/v1_compiled_interface_manifest.json'),
  inputHashes: Object.fromEntries(uniqueFiles.map((file) => [file, sha(file)])),
  dependencyProvenance: preflight.dependencyProvenance,
  transactionCount: 19,
  gasLimitsApproved: false,
  sourceTreeFileCount: uniqueFiles.filter((file) => file.startsWith('contracts/src/v1/')).length,
  evidenceDirectory: `${simulationPath}`,
};
const destination = root + 'deployments/evidence/v1-robinhood-testnet-candidate-release.json';
fs.writeFileSync(destination, JSON.stringify(certificate, null, 2) + '\n');
const env = {...process.env, ...cfg}; delete env.DEPLOYER_PRIVATE_KEY;
const result = spawnSync(process.execPath, ['tools/run-forge.mjs', 'script', 'script/v1/DeployV1RobinhoodTestnetContinuousHolders.s.sol:DeployV1RobinhoodTestnetContinuousHolders', '--sig', 'validateCertificate()', '--rpc-url', rpcUrl, '--sender', cfg.V1_EXPECTED_DEPLOYER, '--non-interactive', '-vv'], {cwd: root, env, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024});
const log = ((result.stdout ?? '') + (result.stderr ?? '')).split(rpcUrl).join('[ROBINHOOD_TESTNET_RPC]');
fs.writeFileSync(simulationOutput + '/certificate-validation.log', log);
if (result.status !== 0 || !log.includes('Script ran successfully.')) {
  certificate.status = 'INVALID_VALIDATION_FAILED'; fs.writeFileSync(destination, JSON.stringify(certificate, null, 2) + '\n');
  throw Error('Release gate rejected certificate');
}
fs.writeFileSync(simulationOutput + '/release-certificate.json', JSON.stringify(certificate, null, 2) + '\n');
console.log(JSON.stringify({status: 'CERTIFICATE_GATE_PASSED_NOT_BROADCAST', chainId: 46630, releaseId: checked.releaseId, payloadHash: checked.payloadHash, expiresAt: certificate.expiresAt, balanceWei: String(balance)}));
