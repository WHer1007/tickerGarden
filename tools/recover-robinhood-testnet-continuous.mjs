import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createPublicClient, decodeFunctionData, defineChain, http, keccak256} from '../apps/web/node_modules/viem/_esm/index.js';

const root = new URL('../', import.meta.url).pathname;
const read = (file) => JSON.parse(fs.readFileSync(root + file));
const ensure = (ok, message) => { if (!ok) throw Error(message); };
const hash = (file) => '0x' + createHash('sha256').update(fs.readFileSync(root + file)).digest('hex');
const certPath = 'deployments/evidence/v1-robinhood-testnet-candidate-release.json';
const cert = read(certPath);
const preview = read('outputs/reviews/robinhood-testnet-continuous-2026-09-08/candidate.preview.json');
const preflight = read('outputs/reviews/robinhood-testnet-continuous-2026-09-08/chain-preflight.json');
const batch = read('outputs/reviews/robinhood-testnet-continuous-simulation-2026-09-08/unsigned-transactions.json');
const journalPath = `deployments/releases/${cert.releaseId}/robinhood-testnet-continuous-transactions.json`;
const journal = read(journalPath);
ensure(journal.length === 8 && journal.every((record, index) => record.index === index && record.status === 'CONFIRMED'), 'Expected exactly eight confirmed records');
for (const [file, expected] of Object.entries(cert.inputHashes)) {
  if (file === 'tools/send-robinhood-testnet-continuous.mjs') continue;
  ensure(hash(file) === expected, `Unexpected certified input drift: ${file}`);
}
const local = readProjectEnv();
ensure(Boolean(local.ALCHEMY_API_KEY), 'Missing ALCHEMY_API_KEY');
const rpc = `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`;
const chain = defineChain({id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: [rpc]}}});
const client = createPublicClient({chain, transport: http(rpc, {timeout: 30_000, retryCount: 2})});
ensure(await client.getChainId() === 46630, 'Wrong chain');
for (const dependency of [...preflight.dependencies, {name: 'RobinhoodTestnetTreasury', address: preflight.treasury.address, codeHash: preflight.treasury.codeHash}]) {
  ensure(keccak256(await client.getCode({address: dependency.address})) === dependency.codeHash, `Dependency drift: ${dependency.name}`);
}
for (let index = 0; index < journal.length; index += 1) {
  const expected = batch.transactions[index].transaction;
  const record = journal[index];
  const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({hash: record.hash}), client.getTransaction({hash: record.hash})]);
  ensure(receipt.status === 'success' && receipt.blockHash === record.blockHash, `Receipt mismatch: ${index}`);
  ensure(transaction.from.toLowerCase() === cert.deployer.toLowerCase() && transaction.to.toLowerCase() === expected.to.toLowerCase() && transaction.nonce === Number(BigInt(expected.nonce)) && keccak256(transaction.input) === keccak256(expected.input), `Transaction mismatch: ${index}`);
}
ensure(await client.getTransactionCount({address: cert.deployer, blockTag: 'pending'}) === 9, 'Expected pending nonce 9');
const orchestratorArtifact = read('contracts/out-v1/V1RobinhoodTestnetDeploymentOrchestrator.sol/V1RobinhoodTestnetDeploymentOrchestrator.json');
const abi = orchestratorArtifact.abi;
const begin = decodeFunctionData({abi, data: batch.transactions[1].transaction.input});
const [authorizer, releaseId, initialized, completed, nextComponent, payloadHash, finalHash, components] = await Promise.all([
  client.readContract({address: preview.orchestrator, abi, functionName: 'authorizer'}),
  client.readContract({address: preview.orchestrator, abi, functionName: 'releaseId'}),
  client.readContract({address: preview.orchestrator, abi, functionName: 'initialized'}),
  client.readContract({address: preview.orchestrator, abi, functionName: 'completed'}),
  client.readContract({address: preview.orchestrator, abi, functionName: 'nextComponent'}),
  client.readContract({address: preview.orchestrator, abi, functionName: 'deploymentPayloadHash'}),
  client.readContract({address: preview.orchestrator, abi, functionName: 'finalHash'}),
  client.readContract({address: preview.orchestrator, abi, functionName: 'ordinaryComponents'}),
]);
ensure(authorizer.toLowerCase() === cert.deployer.toLowerCase() && releaseId === cert.releaseId, 'Orchestrator identity mismatch');
ensure(initialized === true && completed === false && Number(nextComponent) === 6, 'Unexpected staged state');
ensure(payloadHash === cert.payloadHash && payloadHash === begin.args[0] && finalHash === begin.args[2], 'Commitment mismatch');
for (let index = 0; index < 16; index += 1) {
  if (index < 6) {
    ensure(components[index].toLowerCase() === preview.ordinaryComponents[index].toLowerCase(), `Component address mismatch: ${index}`);
    ensure((await client.getCode({address: components[index]})) !== '0x', `Missing component code: ${index}`);
  } else {
    ensure(components[index] === '0x0000000000000000000000000000000000000000', `Unexpected component: ${index}`);
  }
}
const block = await client.getBlock();
cert.inputHashes['tools/send-robinhood-testnet-continuous.mjs'] = hash('tools/send-robinhood-testnet-continuous.mjs');
cert.broadcastStatus = 'PARTIAL_8_OF_19_RECOVERY_VERIFIED';
cert.verifiedAt = Number(block.timestamp);
cert.expiresAt = Number(block.timestamp) + 7200;
cert.recovery = {verifiedAtBlock: String(block.number), verifiedAtBlockHash: block.hash, confirmedTransactions: 8, nextNonce: 9, nextComponent: 6, stagedCommitmentsVerified: true};
fs.writeFileSync(root + certPath, JSON.stringify(cert, null, 2) + '\n');
const cfg = Object.fromEntries(fs.readFileSync(root + 'outputs/reviews/robinhood-testnet-continuous-2026-09-08/candidate.public.env', 'utf8').split('\n').filter(Boolean).map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const env = {...process.env, ...cfg}; delete env.DEPLOYER_PRIVATE_KEY;
const validation = spawnSync(process.execPath, ['tools/run-forge.mjs', 'script', 'script/v1/DeployV1RobinhoodTestnetContinuousHolders.s.sol:DeployV1RobinhoodTestnetContinuousHolders', '--sig', 'validateCertificate()', '--rpc-url', rpc, '--sender', cert.deployer, '--non-interactive', '-vv'], {cwd: root, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});
const log = ((validation.stdout ?? '') + (validation.stderr ?? '')).split(rpc).join('[ROBINHOOD_TESTNET_RPC]');
fs.writeFileSync(root + `deployments/releases/${cert.releaseId}/recovery-certificate-validation.log`, log);
ensure(validation.status === 0 && log.includes('Script ran successfully.'), 'Recovery certificate rejected by release gate');
console.log(JSON.stringify({status: 'PARTIAL_DEPLOYMENT_RECOVERY_VERIFIED', releaseId: cert.releaseId, confirmedTransactions: 8, nextNonce: 9, nextComponent: 6, expiresAt: cert.expiresAt}));
