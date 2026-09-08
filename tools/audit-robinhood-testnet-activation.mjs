import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createPublicClient, decodeFunctionData, defineChain, encodeFunctionData, http, keccak256} from '../apps/web/node_modules/viem/_esm/index.js';

const root = new URL('../', import.meta.url).pathname;
const releaseId = process.env.TG_RH_RELEASE_ID ?? '0x7b2614a529d1d3a06e8826cf38329e211f134c69200acda3b9ced5d4791b4df0';
const directory = root + 'deployments/releases/' + releaseId;
const planPath = directory + '/activation-plan.json';
const plan = JSON.parse(fs.readFileSync(planPath));
const deployment = JSON.parse(fs.readFileSync(directory + '/release-status.json'));
const detailed = JSON.parse(fs.readFileSync(directory + '/robinhood-testnet-46630.v1.deployed.json'));
const shaPath = (file) => '0x' + createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ensure = (ok, message) => { if (!ok) throw Error(message); };
ensure(plan.status === 'AUDITED_READY_FOR_TESTNET_ACTIVATION' && plan.chainId === 46630 && plan.releaseId === releaseId, 'Invalid activation plan identity');
ensure(plan.inputHashes.releaseStatus === shaPath(directory + '/release-status.json'), 'Release status drift');
ensure(plan.inputHashes.fixtureSource === shaPath(root + 'contracts/script/v1/RobinhoodTestnetBaselineFixture.sol'), 'Fixture source drift');
ensure(plan.inputHashes.executionManifest === shaPath(root + 'spec/v1_execution_manifest.json'), 'Execution manifest drift');
ensure(plan.inputHashes.productArtifacts === shaPath(root + 'spec/v1_product_artifact_manifest.json'), 'Product artifact drift');
const local = readProjectEnv();
ensure(Boolean(local.ALCHEMY_API_KEY), 'Missing ALCHEMY_API_KEY');
const isolated = releaseId === '0xf72a2cdf41ec88936213a0325a396df1a286a7a0254f649263f8ec624cb9c0bf';
const rpc = isolated ? 'http://127.0.0.1:18570' : `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`;
const chain = defineChain({id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: [rpc]}}});
const client = createPublicClient({chain, transport: http(rpc, {timeout: 30_000, retryCount: 2})});
ensure(await client.getChainId() === 46630, 'Wrong chain');
const artifact = (name) => JSON.parse(fs.readFileSync(root + `contracts/out-v1/${name}.sol/${name}.json`));
const accessAbi = artifact('AccessManager').abi;
const baselineAbi = artifact('TickerGardenBaselineRegistry').abi;
const quoteAbi = artifact('ApprovedQuoteRegistry').abi;
const templateAbi = artifact('LaunchTemplateRegistry').abi;
const vaultAbi = artifact('ProtocolFeeVault').abi;
const block = await client.getBlock();
const genesis = await client.getBlock({blockNumber: 0n});
ensure(genesis.hash === plan.genesisHash, 'Genesis hash drift');
ensure(await client.getTransactionCount({address: plan.deployer, blockTag: 'pending'}) === plan.transactions[0].nonce, 'Activation nonce drift');
ensure((await client.getCode({address: plan.expected.fixture})) === undefined, 'Fixture address occupied');
ensure((await client.readContract({address: deployment.components.ProtocolFeeVault, abi: vaultAbi, functionName: 'settlementOperator'})).toLowerCase() === plan.deployer.toLowerCase(), 'Settlement operator drift');
for (const contract of detailed.contracts) {
  ensure(keccak256(await client.getCode({address: contract.address})) === contract.runtimeCodeHash, `Runtime drift: ${contract.name}`);
}
const calls = [
  {transaction: plan.transactions[1], abi: baselineAbi, functionName: 'addBaseline', getter: 'baseline', id: plan.identifiers.baselineId},
  {transaction: plan.transactions[2], abi: quoteAbi, functionName: 'addQuoteConfig', getter: 'quoteConfig', id: plan.identifiers.quoteId},
  {transaction: plan.transactions[3], abi: templateAbi, functionName: 'addLaunchTemplate', getter: 'launchTemplate', id: plan.identifiers.templateId},
];
const access = deployment.components.AccessManager;
for (const [index, call] of calls.entries()) {
  ensure(call.transaction.nonce === plan.transactions[0].nonce + index + 1 && call.transaction.inputHash === keccak256(call.transaction.data), `Transaction commitment mismatch: ${call.transaction.id}`);
  const decoded = decodeFunctionData({abi: call.abi, data: call.transaction.data});
  ensure(decoded.functionName === call.functionName && encodeFunctionData({abi: call.abi, functionName: call.functionName, args: decoded.args}) === call.transaction.data, `Calldata decode mismatch: ${call.transaction.id}`);
  const permission = await client.readContract({address: access, abi: accessAbi, functionName: 'canCall', args: [plan.deployer, call.transaction.to, call.transaction.data.slice(0, 10)]});
  ensure(permission[0] === true && permission[1] === 0, `Activation call requires delay: ${call.transaction.id}`);
  const current = await client.readContract({address: call.transaction.to, abi: call.abi, functionName: call.getter, args: [call.id]});
  ensure(current.status === 0, `Activation id already used: ${call.transaction.id}`);
}
ensure((await client.readContract({address: access, abi: accessAbi, functionName: 'hasRole', args: [0n, plan.deployer]}))[0] === true, 'Admin role missing');
ensure(await client.getBalance({address: plan.deployer}) >= BigInt(plan.gasReview.totalActivationCapWei), 'Activation budget unavailable');
const audit = {
  schemaVersion: 1,
  status: 'APPROVED_FOR_ROBINHOOD_TESTNET_ACTIVATION',
  scope: 'ROBINHOOD_TESTNET_ONLY',
  chainId: 46630,
  releaseId,
  planSha256: shaPath(planPath),
  auditedAt: new Date().toISOString(),
  expiresAtUnix: Number(block.timestamp) + 3600,
  auditBlock: {number: String(block.number), hash: block.hash, timestamp: String(block.timestamp)},
  startingNonce: plan.transactions[0].nonce,
  transactions: plan.transactions.map(({id, nonce, to, inputHash}) => ({id, nonce, to, inputHash})),
  checks: {sourceInputsCurrent: true, runtimeCodeHashesCurrent: true, releaseBindingsCurrent: true, settlementOperatorConfigured: true, adminRolePresent: true, callsImmediate: true, calldataRoundTrip: true, identifiersUnused: true, fixtureAddressEmpty: true, budgetAvailable: true},
  exclusions: {roleHandoff: false, marketCreation: false, stockRegistration: false},
};
fs.writeFileSync(directory + '/activation-audit.json', JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({status: audit.status, auditBlock: audit.auditBlock.number, planSha256: audit.planSha256, startingNonce: audit.startingNonce, transactions: audit.transactions.length, expiresAtUnix: audit.expiresAtUnix}));
