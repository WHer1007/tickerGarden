import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {
  createPublicClient,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  http,
  keccak256,
  toBytes,
} from '../apps/web/node_modules/viem/_esm/index.js';

const root = new URL('../', import.meta.url).pathname;
const releaseId = process.env.TG_RH_RELEASE_ID ?? '0x7b2614a529d1d3a06e8826cf38329e211f134c69200acda3b9ced5d4791b4df0';
const directory = root + 'deployments/releases/' + releaseId;
const deployment = JSON.parse(fs.readFileSync(directory + '/release-status.json'));
if (deployment.status !== 'DEPLOYED_VERIFIED_NOT_ACTIVATED' || deployment.chainId !== 46630) throw Error('Release is not eligible for test activation planning');
const local = readProjectEnv();
if (!local.ALCHEMY_API_KEY) throw Error('Missing ALCHEMY_API_KEY');
const isolated = releaseId === '0xf72a2cdf41ec88936213a0325a396df1a286a7a0254f649263f8ec624cb9c0bf';
const rpc = isolated ? 'http://127.0.0.1:18570' : `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`;
const chain = defineChain({id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: [rpc]}}});
const client = createPublicClient({chain, transport: http(rpc, {timeout: 30_000, retryCount: 2})});
if (await client.getChainId() !== 46630) throw Error('Wrong chain');
const artifact = (name) => JSON.parse(fs.readFileSync(root + `contracts/out-v1/${name}.sol/${name}.json`));
const accessAbi = artifact('AccessManager').abi;
const baselineAbi = artifact('TickerGardenBaselineRegistry').abi;
const quoteAbi = artifact('ApprovedQuoteRegistry').abi;
const templateAbi = artifact('LaunchTemplateRegistry').abi;
const fixtureArtifact = artifact('RobinhoodTestnetBaselineFixture');
const block = await client.getBlock();
const genesis = await client.getBlock({blockNumber: 0n});
const nonce = await client.getTransactionCount({address: deployment.deployer, blockTag: 'pending'});
const fixture = getContractAddress({from: deployment.deployer, nonce: BigInt(nonce)});
if ((await client.getCode({address: fixture})) !== undefined) throw Error('Predicted fixture address is occupied');
const hashText = (value) => keccak256(toBytes(value));
const baselineId = hashText(`${releaseId}:ROBINHOOD_TESTNET_BASELINE`);
const templateId = hashText(`${releaseId}:ROBINHOOD_TESTNET_TEMPLATE`);
const supply = 1_000_000_000n * 10n ** 18n;
const phantomQuote = BigInt(local.V1_NATIVE_PHANTOM_WEI);
const graduationThreshold = BigInt(local.V1_NATIVE_GRADUATION_WEI);
const fixtureCodeHash = keccak256(fixtureArtifact.deployedBytecode.object);
const baseline = {
  referenceChainId: 46630n,
  referenceFactory: fixture,
  referenceFactoryCodeHash: fixtureCodeHash,
  launchConfigId: 0n,
  supply,
  curveFeeBps: 100n,
  poolFee: 0,
  tickSpacing: 200,
  behaviorVectorRoot: keccak256(fs.readFileSync(root + 'spec/v1_pons_behavior_vectors.json')),
  status: 1,
};
const quoteId = keccak256(encodeAbiParameters(
  [{type: 'bytes32'}, {type: 'uint256'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'address'}, {type: 'uint8'}, {type: 'uint256'}, {type: 'uint256'}],
  [hashText('TICKERGARDEN_V1_QUOTE_ECONOMICS'), 1n, 46630n, baselineId, '0x0000000000000000000000000000000000000000', 18, phantomQuote, graduationThreshold],
));
const quote = {tickerGardenBaselineId: baselineId, quoteAsset: '0x0000000000000000000000000000000000000000', quoteDecimals: 18, phantomQuote, graduationThreshold, economicsHash: quoteId, status: 1};
const codeHash = async (address) => keccak256(await client.getCode({address}));
const factoryAbi = artifact('TickerGardenFactoryV1').abi;
const feePolicyId = await client.readContract({address: deployment.factory, abi: factoryAbi, functionName: 'feePolicyId'});
const template = {
  memeTokenImplementation: deployment.components.TickerMemeTokenV1Implementation,
  memeTokenCodeHash: await codeHash(deployment.components.TickerMemeTokenV1Implementation),
  curveImplementation: deployment.components.TickerGardenCurveImplementation,
  curveCodeHash: await codeHash(deployment.components.TickerGardenCurveImplementation),
  gaugeImplementation: deployment.components.MemeStockGauge,
  gaugeCodeHash: await codeHash(deployment.components.MemeStockGauge),
  graduatedHook: deployment.hook,
  hookCodeHash: await codeHash(deployment.hook),
  graduationExecutor: deployment.graduationExecutor,
  graduationExecutorCodeHash: await codeHash(deployment.graduationExecutor),
  feePolicyId,
  executionSpecId: hashText('V1-EXEC-11'),
  status: 1,
};
const transactions = [
  {id: 'deploy-baseline-fixture', nonce, to: null, data: encodeDeployData({abi: fixtureArtifact.abi, bytecode: fixtureArtifact.bytecode.object, args: []}), expectedContract: fixture},
  {id: 'add-baseline', nonce: nonce + 1, to: deployment.components.TickerGardenBaselineRegistry, data: encodeFunctionData({abi: baselineAbi, functionName: 'addBaseline', args: [baselineId, baseline]})},
  {id: 'add-native-eth-quote', nonce: nonce + 2, to: deployment.components.ApprovedQuoteRegistry, data: encodeFunctionData({abi: quoteAbi, functionName: 'addQuoteConfig', args: [quoteId, quote]})},
  {id: 'add-launch-template', nonce: nonce + 3, to: deployment.components.LaunchTemplateRegistry, data: encodeFunctionData({abi: templateAbi, functionName: 'addLaunchTemplate', args: [templateId, template]})},
].map((transaction) => ({...transaction, value: '0', inputHash: keccak256(transaction.data)}));
for (const [transaction, abi, functionName] of [[transactions[1], baselineAbi, 'addBaseline'], [transactions[2], quoteAbi, 'addQuoteConfig'], [transactions[3], templateAbi, 'addLaunchTemplate']]) {
  const decoded = decodeFunctionData({abi, data: transaction.data});
  if (decoded.functionName !== functionName || encodeFunctionData({abi, functionName, args: decoded.args}) !== transaction.data) throw Error(`Calldata round-trip failed: ${transaction.id}`);
}
const access = deployment.components.AccessManager;
const [admin, baselineCanCall, quoteCanCall, templateCanCall] = await Promise.all([
  client.readContract({address: access, abi: accessAbi, functionName: 'hasRole', args: [0n, deployment.deployer]}),
  client.readContract({address: access, abi: accessAbi, functionName: 'canCall', args: [deployment.deployer, transactions[1].to, transactions[1].data.slice(0, 10)]}),
  client.readContract({address: access, abi: accessAbi, functionName: 'canCall', args: [deployment.deployer, transactions[2].to, transactions[2].data.slice(0, 10)]}),
  client.readContract({address: access, abi: accessAbi, functionName: 'canCall', args: [deployment.deployer, transactions[3].to, transactions[3].data.slice(0, 10)]}),
]);
if (!admin[0] || admin[1] !== 0 || !baselineCanCall[0] || baselineCanCall[1] !== 0 || !quoteCanCall[0] || quoteCanCall[1] !== 0 || !templateCanCall[0] || templateCanCall[1] !== 0) throw Error('Activation caller lacks immediate role');
const [existingBaseline, existingQuote, existingTemplate, balance, fixtureGas] = await Promise.all([
  client.readContract({address: transactions[1].to, abi: baselineAbi, functionName: 'baseline', args: [baselineId]}),
  client.readContract({address: transactions[2].to, abi: quoteAbi, functionName: 'quoteConfig', args: [quoteId]}),
  client.readContract({address: transactions[3].to, abi: templateAbi, functionName: 'launchTemplate', args: [templateId]}),
  client.getBalance({address: deployment.deployer}),
  client.estimateGas({account: deployment.deployer, data: transactions[0].data}),
]);
if (existingBaseline.status !== 0 || existingQuote.status !== 0 || existingTemplate.status !== 0) throw Error('Activation identifier already used');
if (balance < 10_000_000_000_000_000n) throw Error('Require at least 0.01 test ETH');
const sha = (file) => '0x' + createHash('sha256').update(fs.readFileSync(root + file)).digest('hex');
const json = (_key, value) => typeof value === 'bigint' ? value.toString() : value;
const plan = {
  schemaVersion: 1,
  status: 'AUDITED_READY_FOR_TESTNET_ACTIVATION',
  scope: 'ROBINHOOD_TESTNET_ONLY',
  chainId: 46630,
  genesisHash: genesis.hash,
  releaseId,
  deployer: deployment.deployer,
  auditBlock: {number: String(block.number), hash: block.hash, timestamp: String(block.timestamp)},
  preconditions: {runtimeDeploymentVerified: true, currentUserClaimModeRequired: true, adminRole: '0', adminExecutionDelaySeconds: 0, registryCallsImmediate: true, candidateIdsUnused: true, fixtureAddressEmpty: true},
  economics: {supplyRaw: String(supply), curveFeeBps: 100, phantomQuoteRaw: String(phantomQuote), graduationThresholdRaw: String(graduationThreshold), graduationThresholdEth: '0.42', pairedAsset: 'NATIVE_ETH'},
  identifiers: {baselineId, quoteId, templateId},
  expected: {fixture, baseline, quote, template},
  transactions,
  gasReview: {fixtureEstimatedGas: String(fixtureGas), remainingTransactions: 'ESTIMATE_AND_SIMULATE_AFTER_PRECEDING_RECEIPT', perTransactionCapWei: '5000000000000000', totalActivationCapWei: '10000000000000000'},
  inputHashes: {
    releaseStatus: sha(`deployments/releases/${releaseId}/release-status.json`),
    fixtureSource: sha('contracts/script/v1/RobinhoodTestnetBaselineFixture.sol'),
    executionManifest: sha('spec/v1_execution_manifest.json'),
    productArtifacts: sha('spec/v1_product_artifact_manifest.json'),
  },
  limitations: ['Activates one native ETH test quote only.', 'Does not transfer AccessManager roles or create a market.', 'The 0.42 ETH graduation threshold is test-only.'],
};
fs.writeFileSync(directory + '/activation-plan.json', JSON.stringify(plan, json, 2) + '\n');
console.log(JSON.stringify({status: plan.status, auditBlock: plan.auditBlock.number, startingNonce: nonce, fixture, baselineId, quoteId, templateId, transactions: transactions.length, graduationThresholdEth: '0.42'}));
