import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
} from '../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';

const root = new URL('../', import.meta.url).pathname;
const releaseId = process.env.TG_RH_RELEASE_ID ?? '0x7b2614a529d1d3a06e8826cf38329e211f134c69200acda3b9ced5d4791b4df0';
const directory = root + 'deployments/releases/' + releaseId;
const planPath = directory + '/activation-plan.json';
const auditPath = directory + '/activation-audit.json';
const activationPath = directory + '/activation.json';
const detailPath = directory + '/robinhood-testnet-46630.v1.deployed.json';
const releaseStatusPath = directory + '/release-status.json';
const pairedAssetsPath = process.env.TG_RH_STAGED_ACTIVATION === '1' ? directory + '/paired-assets.json' : root + 'deployments/manifests/robinhood-testnet-46630.paired-assets.json';
const walletPath = '/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';
const perTransactionCap = 5_000_000_000_000_000n;
const totalCap = 10_000_000_000_000_000n;
const ensure = (ok, message) => { if (!ok) throw Error(message); };
const readJson = (path) => JSON.parse(fs.readFileSync(path));
const writeJson = (path, value, mode) => {
  const temporary = path + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n', mode ? {mode} : undefined);
  fs.renameSync(temporary, path);
};
const sha256 = (path) => '0x' + createHash('sha256').update(fs.readFileSync(path)).digest('hex');

const plan = readJson(planPath);
const audit = readJson(auditPath);
const releaseStatus = readJson(releaseStatusPath);
const detailed = readJson(detailPath);
ensure(plan.status === 'AUDITED_READY_FOR_TESTNET_ACTIVATION' && audit.status === 'APPROVED_FOR_ROBINHOOD_TESTNET_ACTIVATION', 'Activation is not approved');
ensure(plan.chainId === 46630 && audit.chainId === 46630 && plan.releaseId === releaseId && audit.releaseId === releaseId, 'Activation identity mismatch');
ensure(audit.planSha256 === sha256(planPath), 'Activation plan changed after audit');
ensure(plan.transactions.length === 4 && audit.transactions.length === 4, 'Unexpected activation transaction count');
for (let index = 0; index < plan.transactions.length; index += 1) {
  const planned = plan.transactions[index];
  const approved = audit.transactions[index];
  ensure(planned.id === approved.id && planned.nonce === approved.nonce && planned.to === approved.to && planned.inputHash === approved.inputHash, `Audit commitment mismatch: ${planned.id}`);
  ensure(planned.value === '0' && planned.inputHash === keccak256(planned.data), `Invalid planned transaction: ${planned.id}`);
}

const local = readProjectEnv();
ensure(Boolean(local.ALCHEMY_API_KEY), 'Missing ALCHEMY_API_KEY');
const isolated = releaseId === '0xf72a2cdf41ec88936213a0325a396df1a286a7a0254f649263f8ec624cb9c0bf';
const rpc = isolated ? 'http://127.0.0.1:18570' : `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`;
const chain = defineChain({id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: [rpc]}}});
const client = createPublicClient({chain, transport: http(rpc, {timeout: 30_000, retryCount: 2})});
ensure(await client.getChainId() === 46630, 'Wrong chain');
const currentBlock = await client.getBlock();
ensure(Number(currentBlock.timestamp) <= audit.expiresAtUnix && Date.now() / 1000 <= audit.expiresAtUnix, 'Activation audit expired; regenerate and re-audit');

const walletStat = fs.lstatSync(walletPath);
ensure(!walletStat.isSymbolicLink() && (walletStat.mode & 0o077) === 0, 'Wallet file must be owner-only and not a symlink');
const account = privateKeyToAccount(readJson(walletPath).privateKey);
ensure(account.address.toLowerCase() === plan.deployer.toLowerCase(), 'Wrong activation signer');
const signer = createWalletClient({account, chain, transport: http(rpc, {timeout: 30_000})});
const artifact = (name) => JSON.parse(fs.readFileSync(root + `contracts/out-v1/${name}.sol/${name}.json`));
const baselineAbi = artifact('TickerGardenBaselineRegistry').abi;
const quoteAbi = artifact('ApprovedQuoteRegistry').abi;
const templateAbi = artifact('LaunchTemplateRegistry').abi;
const factoryAbi = artifact('TickerGardenFactoryV1').abi;
const routerAbi = artifact('LaunchAndBuyRouter').abi;

const activation = fs.existsSync(activationPath) ? readJson(activationPath) : {
  schemaVersion: 1,
  status: 'BROADCAST_IN_PROGRESS',
  scope: 'ROBINHOOD_TESTNET_ONLY',
  chainId: 46630,
  releaseId,
  planSha256: audit.planSha256,
  auditBlock: audit.auditBlock,
  transactions: [],
};
ensure(activation.releaseId === releaseId && activation.planSha256 === audit.planSha256, 'Existing activation journal belongs to another plan');
const persist = () => writeJson(activationPath, activation, 0o600);
let spent = activation.transactions.filter((entry) => entry.status === 'CONFIRMED').reduce((sum, entry) => sum + BigInt(entry.feeWei), 0n);

async function confirmIdentity(planned, record) {
  const receipt = await client.waitForTransactionReceipt({hash: record.transactionHash, confirmations: 2, timeout: 180_000});
  const [transaction, canonical] = await Promise.all([
    client.getTransaction({hash: record.transactionHash}),
    client.getBlock({blockNumber: receipt.blockNumber}),
  ]);
  ensure(canonical.hash === receipt.blockHash, `Non-canonical receipt: ${planned.id}`);
  ensure(transaction.from.toLowerCase() === plan.deployer.toLowerCase() && transaction.nonce === planned.nonce && keccak256(transaction.input) === planned.inputHash && transaction.value === 0n, `Receipt identity mismatch: ${planned.id}`);
  if (planned.to === null) ensure(transaction.to === null && receipt.contractAddress?.toLowerCase() === planned.expectedContract.toLowerCase(), 'Fixture deployment address mismatch');
  else ensure(transaction.to?.toLowerCase() === planned.to.toLowerCase(), `Receipt destination mismatch: ${planned.id}`);
  record.status = receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED';
  record.blockNumber = String(receipt.blockNumber);
  record.blockHash = receipt.blockHash;
  record.gasUsed = String(receipt.gasUsed);
  record.effectiveGasPrice = String(receipt.effectiveGasPrice);
  record.feeWei = String(receipt.gasUsed * receipt.effectiveGasPrice);
  persist();
  ensure(receipt.status === 'success', `Activation transaction reverted: ${planned.id}`);
  return receipt;
}

const lockPath = directory + '/activation-sender.lock';
const lock = fs.openSync(lockPath, 'wx', 0o600);
fs.writeSync(lock, String(process.pid));
try {
  for (const planned of plan.transactions) {
    let record = activation.transactions.find((entry) => entry.id === planned.id);
    if (record) {
      ensure(record.nonce === planned.nonce && record.to === planned.to && record.inputHash === planned.inputHash, `Activation journal mismatch: ${planned.id}`);
      if (record.status === 'CONFIRMED') continue;
    } else {
      ensure(await client.getTransactionCount({address: account.address, blockTag: 'pending'}) === planned.nonce, `Pending nonce drift before ${planned.id}`);
      const requestBase = {account: account.address, data: planned.data, value: 0n, ...(planned.to ? {to: planned.to} : {})};
      const estimatedGas = await client.estimateGas(requestBase);
      const runtimeFloor = planned.expectedContract ? BigInt((artifact('RobinhoodTestnetBaselineFixture').deployedBytecode.object.length - 2) / 2) * 240n + 300_000n : 0n;
      const gas = [estimatedGas * 13n / 10n, runtimeFloor].reduce((left, right) => left > right ? left : right);
      const fees = isolated ? {gasPrice:(await client.getGasPrice())*2n} : await client.estimateFeesPerGas();
      const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
      const maxCost = gas * maxFeePerGas;
      ensure(maxCost <= perTransactionCap && spent + maxCost <= totalCap, `Activation budget cap exceeded: ${planned.id}`);
      ensure(await client.getBalance({address: account.address}) >= maxCost, 'Insufficient activation balance');
      const prepared = await signer.prepareTransactionRequest({account, chain, data: planned.data, value: 0n, nonce: planned.nonce, gas, ...(isolated?{type:'legacy'}:{}), ...fees, ...(planned.to ? {to: planned.to} : {})});
      const signed = await signer.signTransaction(prepared);
      record = {id: planned.id, nonce: planned.nonce, to: planned.to, inputHash: planned.inputHash, transactionHash: keccak256(signed), status: 'SIGNED_INTENT', estimatedGas: String(estimatedGas), gasLimit: String(gas), maxFeePerGas: String(maxFeePerGas)};
      activation.transactions.push(record);
      persist();
      await client.sendRawTransaction({serializedTransaction: signed});
      record.status = 'SUBMITTED';
      persist();
    }
    const receipt = await confirmIdentity(planned, record);
    spent += receipt.gasUsed * receipt.effectiveGasPrice;
    console.log(JSON.stringify({id: planned.id, nonce: planned.nonce, status: record.status, transactionHash: record.transactionHash, blockNumber: record.blockNumber, feeWei: record.feeWei}));
    if (planned.expectedContract) {
      const code = await client.getCode({address: planned.expectedContract});
      ensure(Boolean(code) && code !== '0x' && keccak256(code) === plan.expected.baseline.referenceFactoryCodeHash, 'Fixture runtime verification failed');
    }
  }

  const [baseline, quote, template] = await Promise.all([
    client.readContract({address: plan.transactions[1].to, abi: baselineAbi, functionName: 'baseline', args: [plan.identifiers.baselineId]}),
    client.readContract({address: plan.transactions[2].to, abi: quoteAbi, functionName: 'quoteConfig', args: [plan.identifiers.quoteId]}),
    client.readContract({address: plan.transactions[3].to, abi: templateAbi, functionName: 'launchTemplate', args: [plan.identifiers.templateId]}),
  ]);
  ensure(baseline.status === 1 && quote.status === 1 && template.status === 1, 'Registry activation verification failed');
  ensure(baseline.referenceFactory.toLowerCase() === plan.expected.fixture.toLowerCase() && String(quote.graduationThreshold) === plan.economics.graduationThresholdRaw && template.graduationExecutor.toLowerCase() === releaseStatus.graduationExecutor.toLowerCase(), 'Activated registry values drifted');

  const hashText = (value) => keccak256(toBytes(value));
  const params = {
    assetUid: '0x' + '0'.repeat(64),
    tickerGardenBaselineId: plan.identifiers.baselineId,
    quoteAssetConfigId: plan.identifiers.quoteId,
    launchTemplateId: plan.identifiers.templateId,
    expectedEconomics: '0x' + '0'.repeat(64),
    creatorRevenueBeneficiary: account.address,
    name: 'TickerGarden Robinhood Testnet Smoke',
    symbol: 'tgRHSMOKE',
    metadataURI: 'data:application/json,%7B%22testOnly%22%3Atrue%7D',
    salt: hashText(`${releaseId}:READ_ONLY_ACTIVATION_SMOKE`),
    creatorTaxBps: 500,
    creatorFeesToHolders: true,
    stakingEnabled: false,
    burnMemeFees: false,
  };
  params.expectedEconomics = await client.readContract({account: account.address, address: releaseStatus.factory, abi: factoryAbi, functionName: 'previewMarketEconomics', args: [params]});
  await client.simulateContract({account: account.address, address: releaseStatus.components.LaunchAndBuyRouter, abi: routerAbi, functionName: 'launchAndBuy', args: [params, 1_000_000_000_000_000n, 1n, account.address], value: 1_500_000_000_000_000n});

  const observedBlock = await client.getBlock();
  activation.status = 'ACTIVE_TEST_ONLY';
  activation.baselineId = plan.identifiers.baselineId;
  activation.quoteId = plan.identifiers.quoteId;
  activation.templateId = plan.identifiers.templateId;
  activation.baselineFixture = plan.expected.fixture;
  activation.phantomQuote = plan.economics.phantomQuoteRaw;
  activation.graduationThreshold = plan.economics.graduationThresholdRaw;
  activation.launchAndBuySimulation = 'PASSED_READ_ONLY_NO_MARKET_CREATED';
  activation.totalFeeWei = String(spent);
  activation.activationBlock = {number: String(observedBlock.number), hash: observedBlock.hash, timestamp: String(observedBlock.timestamp)};
  activation.observedAt = new Date().toISOString();
  persist();

  const activationSummary = {performed: true, registriesConfigured: true, rolesTransferred: false, marketsCreated: false, baselineId: activation.baselineId, quoteId: activation.quoteId, templateId: activation.templateId, baselineFixture: activation.baselineFixture, activationBlock: activation.activationBlock.number};
  writeJson(detailPath, {...detailed, status: 'DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY', activation: {quote: true, baseline: true, template: true}, activationManifest: 'activation.json', balanceWei: String(await client.getBalance({address: account.address})), publicTestnetE2E: false});
  writeJson(releaseStatusPath, {...releaseStatus, status: 'DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY', activation: activationSummary, activationManifest: 'activation.json', updatedAt: new Date().toISOString()});
  writeJson(pairedAssetsPath, {
    schemaVersion: 1,
    status: 'REGISTRY_ACTIVE',
    networkScope: 'ROBINHOOD_TESTNET_ONLY',
    chainId: 46630,
    releaseId,
    baselineId: activation.baselineId,
    templateId: activation.templateId,
    supplyReferenceRaw: plan.economics.supplyRaw,
    assets: [{symbol: 'ETH', name: 'Native Ether', address: '0x0000000000000000000000000000000000000000', decimals: 18, quoteAssetConfigId: activation.quoteId, phantomQuote: activation.phantomQuote, graduationThreshold: activation.graduationThreshold, status: 'ACTIVE_TEST_ONLY'}],
    limitations: ['Testnet-only native ETH quote.', 'The 0.42 ETH graduation threshold is intentionally reduced for testing.', 'Production activation on Robinhood Chain Mainnet requires a separate reviewed release.'],
    observedAt: activation.observedAt,
  });
  console.log(JSON.stringify({status: activation.status, releaseId, baselineId: activation.baselineId, quoteId: activation.quoteId, templateId: activation.templateId, baselineFixture: activation.baselineFixture, transactions: activation.transactions.length, totalFeeWei: activation.totalFeeWei, launchAndBuySimulation: activation.launchAndBuySimulation}));
} finally {
  fs.closeSync(lock);
  fs.unlinkSync(lockPath);
}
