import {readProjectEnv} from "./environment.mjs";
import {reviewPath, simulationPath} from "./robinhood-deployment-run.mjs";
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
} from '../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';
import {verifyBatch, output as simulationOutput} from './verify-robinhood-testnet-continuous-simulation.mjs';

const root = new URL('../', import.meta.url).pathname;
const mode = process.argv[2];
if (!['check', 'send'].includes(mode)) throw Error('Use check or send');
const read = (file) => JSON.parse(fs.readFileSync(root + file));
const ensure = (ok, message) => { if (!ok) throw Error(message); };
const cert = read('deployments/evidence/v1-robinhood-testnet-candidate-release.json');
const checked = verifyBatch();
ensure(cert.status === 'VERIFIED' && cert.chainId === 46630 && cert.releaseId === checked.releaseId && cert.payloadHash === checked.payloadHash, 'Invalid release certificate identity');
for (const [file, hash] of Object.entries(cert.inputHashes)) {
  ensure('0x' + createHash('sha256').update(fs.readFileSync(root + file)).digest('hex') === hash, `Certificate input drift: ${file}`);
}
const local = readProjectEnv();
ensure(Boolean(local.ALCHEMY_API_KEY), 'Missing ALCHEMY_API_KEY');
const rpc = (process.env.TG_RH_DEPLOYMENT_RUN === 'frontend-independent-2026-09-08' ? 'http://127.0.0.1:18570' : `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`);
const chain = defineChain({id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: [rpc]}}});
const client = createPublicClient({chain, transport: http(rpc, {timeout: 30_000, retryCount: 2})});
ensure(await client.getChainId() === 46630, 'Wrong chain');
const block = await client.getBlock();
ensure(Number(block.timestamp) >= cert.verifiedAt && Number(block.timestamp) <= cert.expiresAt && Date.now() / 1000 <= cert.expiresAt, 'Release certificate expired');
const preflight = read(`${reviewPath}/chain-preflight.json`);
for (const dependency of [...preflight.dependencies, {name: 'RobinhoodTestnetTreasury', address: preflight.treasury.address, codeHash: preflight.treasury.codeHash}]) {
  ensure(keccak256(await client.getCode({address: dependency.address})) === dependency.codeHash, `Dependency drift: ${dependency.name}`);
}

const walletPath = '/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';
const stat = fs.lstatSync(walletPath);
ensure(!stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'Unsafe wallet permissions');
const wallet = JSON.parse(fs.readFileSync(walletPath));
const account = privateKeyToAccount(wallet.privateKey);
ensure(account.address.toLowerCase() === cert.deployer.toLowerCase(), 'Wrong signer');

const batch = read(`${simulationPath}/unsigned-transactions.json`);
const dir = root + 'deployments/releases/' + cert.releaseId;
fs.mkdirSync(dir, {recursive: true});
const journalPath = dir + '/robinhood-testnet-continuous-transactions.json';
const records = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath)) : [];
const cap = 20_000_000_000_000_000n;
let reserved = 0n;
let spent = records.filter((record) => record.status === 'CONFIRMED').reduce((sum, record) => sum + BigInt(record.feeWei), 0n);

const artifact = (name) => {
  const source = ['TickerMemeTokenV1Implementation', 'TickerGardenCurveImplementation'].includes(name)
    ? 'TickerGardenFactoryV1'
    : name;
  const candidates = [`contracts/out-v1/${source}.sol/${name}.json`, `contracts/out-v1/${source}.s.sol/${name}.json`];
  const file = candidates.find((candidate) => fs.existsSync(root + candidate));
  return read(file);
};
const ordinaryNames = [
  'AccessManager', 'OfficialStockRegistryV1', 'ApprovedQuoteRegistry', 'TickerGardenBaselineRegistry',
  'LaunchTemplateRegistry', 'LaunchConfigResolver', 'TickerMemeTokenV1Implementation', 'TickerGardenCurveImplementation',
  'MemeStockGauge', 'LaunchAndBuyRouter', 'MarketRegistryV1', 'CreatorRevenueRegistry', 'AllocationManager',
  'UserStockVault', 'HolderRewardsDistributorV1', 'ProtocolFeeVault',
];
const runtimeGas = (name) => BigInt((artifact(name).deployedBytecode.object.length - 2) / 2) * 200n;
const finishRuntimeGas = ['V1HookExecutorDeployer', 'TickerGardenMemeHook', 'GraduationExecutor', 'TickerGardenFactoryV1'].reduce((sum, name) => sum + runtimeGas(name), 0n);
const gasFloor = (index) => {
  if (index === 0) return runtimeGas('V1RobinhoodTestnetDeploymentOrchestrator') * 13n / 10n + 500_000n;
  if (index >= 2 && index <= 17) return runtimeGas(ordinaryNames[index - 2]) * 13n / 10n + 500_000n;
  if (index === 18) return finishRuntimeGas * 13n / 10n + 1_500_000n;
  return 250_000n;
};
console.log(JSON.stringify({mode, chainId: 46630, releaseId: cert.releaseId, transactions: batch.transactions.length, priorRecords: records.length, budgetCapWei: String(cap)}));
if (mode === 'check') {
  ensure(await client.getTransactionCount({address: account.address, blockTag: 'pending'}) === checked.firstNonce, 'Pending nonce drift');
  process.exit(0);
}

const lockPath = dir + '/robinhood-testnet-sender.lock';
const lock = fs.openSync(lockPath, 'wx', 0o600);
fs.writeSync(lock, String(process.pid));
const persist = () => {
  const temporary = journalPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(records, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(temporary, journalPath);
};
try {
  const signer = createWalletClient({account, chain, transport: http(rpc, {timeout: 30_000})});
  for (let index = 0; index < batch.transactions.length; index += 1) {
    ensure(Date.now() / 1000 <= cert.expiresAt, 'Certificate expired during deployment');
    const transaction = batch.transactions[index].transaction;
    const nonce = Number(BigInt(transaction.nonce));
    const inputHash = keccak256(transaction.input);
    let record = records[index];
    if (record) ensure(record.index === index && record.nonce === nonce && record.inputHash === inputHash && record.to.toLowerCase() === transaction.to.toLowerCase(), 'Journal mismatch');
    if (!record) {
      ensure(await client.getTransactionCount({address: account.address, blockTag: 'pending'}) === nonce, 'Pending nonce drift; reconcile before continuing');
      const estimated = await client.estimateGas({account: account.address, to: transaction.to, data: transaction.input, value: 0n});
      const limit = [estimated * 13n / 10n, gasFloor(index)].reduce((a, b) => a > b ? a : b);
      const legacy = process.env.TG_RH_DEPLOYMENT_RUN === 'frontend-independent-2026-09-08';
      const fees = legacy ? {gasPrice: (await client.getGasPrice()) * 2n} : await client.estimateFeesPerGas();
      const maxCost = limit * (fees.gasPrice ?? fees.maxFeePerGas);
      ensure(spent + reserved + maxCost <= cap, 'Deployment budget cap exceeded');
      ensure(await client.getBalance({address: account.address}) >= maxCost, 'Insufficient balance');
      const prepared = await signer.prepareTransactionRequest({account, chain, to: transaction.to, data: transaction.input, value: 0n, nonce, gas: limit, ...(legacy ? {type: 'legacy'} : {}), ...fees});
      const signed = await signer.signTransaction(prepared);
      record = {index, nonce, to: transaction.to, inputHash, hash: keccak256(signed), status: 'SIGNED_INTENT', estimatedGas: String(estimated), gasFloor: String(gasFloor(index)), gasLimit: String(limit), maxFeePerGas: String(fees.gasPrice ?? fees.maxFeePerGas)};
      records.push(record); persist(); reserved += maxCost;
      await client.sendRawTransaction({serializedTransaction: signed});
      record.status = 'SUBMITTED'; persist();
    }
    const receipt = await client.waitForTransactionReceipt({hash: record.hash, confirmations: 2, timeout: 180_000});
    const [actual, canonical] = await Promise.all([client.getTransaction({hash: record.hash}), client.getBlock({blockNumber: receipt.blockNumber})]);
    ensure(canonical.hash === receipt.blockHash && actual.from.toLowerCase() === cert.deployer.toLowerCase() && actual.to.toLowerCase() === transaction.to.toLowerCase() && actual.nonce === nonce && keccak256(actual.input) === inputHash && actual.value === 0n, 'Receipt identity mismatch');
    record.status = receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED';
    record.blockNumber = String(receipt.blockNumber); record.blockHash = receipt.blockHash;
    record.gasUsed = String(receipt.gasUsed); record.effectiveGasPrice = String(receipt.effectiveGasPrice);
    record.feeWei = String(receipt.gasUsed * receipt.effectiveGasPrice); persist();
    ensure(receipt.status === 'success', 'Transaction reverted; deployment stopped');
    spent += BigInt(record.feeWei);
    console.log(JSON.stringify({index, nonce, status: record.status, hash: record.hash, gasUsed: record.gasUsed, spentWei: String(spent)}));
  }
  console.log(JSON.stringify({status: 'DEPLOYED_NOT_ACTIVATED', releaseId: cert.releaseId, transactions: records.length, totalFeeWei: String(spent), evidence: journalPath}));
} finally {
  fs.closeSync(lock);
  fs.unlinkSync(lockPath);
}
