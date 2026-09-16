throw new Error('Archived release-specific workflow. Historical release operations must not be replayed.');

import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, keccak256, toBytes } from '../apps/web/node_modules/viem/_esm/index.js';
import { privateKeyToAccount } from '../apps/web/node_modules/viem/_esm/accounts/index.js';

const root = new URL('../', import.meta.url).pathname;
const releaseId = '0xf7024d03f3844c5b40abfeda80cb4e8c6edc307ba60a17c8c6d2bc9296e26e41';
const releaseDir = `${root}deployments/releases/${releaseId}`;
const activationPath = `${releaseDir}/test-asset-activation.json`;
const planPath = `${releaseDir}/test-asset-activation-plan.json`;
const release = JSON.parse(fs.readFileSync(`${releaseDir}/release-status.json`));
const activation = JSON.parse(fs.readFileSync(activationPath));
const plan = JSON.parse(fs.readFileSync(planPath));
const env = readProjectEnv();
if (!env.ALCHEMY_API_KEY) throw Error('Missing ALCHEMY_API_KEY');
if (activation.status !== 'ACTIVE_TEST_ONLY' || plan.scope !== 'ROBINHOOD_TESTNET_SYNTHETIC_ASSETS_ONLY') throw Error('Rejected synthetic activation is not in expected active state');

const rpc = `https://robinhood-testnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
if (await client.getChainId() !== 46630) throw Error('Wrong chain');

const artifact = name => JSON.parse(fs.readFileSync(`${root}contracts/out-v1/${name}.sol/${name}.json`));
const statusAbi = artifact('OfficialStockRegistryV1').abi;
const quoteAbi = artifact('ApprovedQuoteRegistry').abi;

const walletPath = '/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';
const stat = fs.lstatSync(walletPath);
if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Wallet file permissions are unsafe');
const account = privateKeyToAccount(JSON.parse(fs.readFileSync(walletPath)).privateKey);
if (account.address.toLowerCase() !== release.deployer.toLowerCase()) throw Error('Wrong signer');
const wallet = createWalletClient({ account, chain, transport: http(rpc, { timeout: 30_000 }) });
const reasonHash = keccak256(toBytes('TICKERGARDEN_RH_TESTNET_SYNTHETIC_ASSET_REJECTED_USE_CANONICAL_2026_09_08'));
const operations = [
  ...plan.stocks.map(row => ({ id: `pause-${row.symbol.toLowerCase()}-staking`, address: release.components.OfficialStockRegistryV1, abi: statusAbi, read: 'asset', write: 'pauseAsset', key: row.uid })),
  ...plan.quotes.map(row => ({ id: `pause-${row.symbol.toLowerCase()}-quote`, address: release.components.ApprovedQuoteRegistry, abi: quoteAbi, read: 'quoteConfig', write: 'pauseQuote', key: row.configId })),
];

const records = [];
for (const operation of operations) {
  let value = await client.readContract({ address: operation.address, abi: operation.abi, functionName: operation.read, args: [operation.key] });
  if (value.status === 2) { records.push({ id: operation.id, status: 'ALREADY_PAUSED' }); continue; }
  if (value.status !== 1) throw Error(`${operation.id} is not active`);
  const data = encodeFunctionData({ abi: operation.abi, functionName: operation.write, args: [operation.key, reasonHash] });
  const request = { account, chain, to: operation.address, data, value: 0n };
  const estimate = await client.estimateGas(request);
  const fees = await client.estimateFeesPerGas();
  const gas = estimate * 13n / 10n;
  const maxFee = fees.maxFeePerGas ?? fees.gasPrice;
  if (gas * maxFee > 5_000_000_000_000_000n) throw Error(`Gas cap exceeded: ${operation.id}`);
  const prepared = await wallet.prepareTransactionRequest({ ...request, gas, ...fees });
  const signed = await wallet.signTransaction(prepared);
  const hash = await client.sendRawTransaction({ serializedTransaction: signed });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 180_000 });
  if (receipt.status !== 'success') throw Error(`Pause failed: ${operation.id}`);
  value = await client.readContract({ address: operation.address, abi: operation.abi, functionName: operation.read, args: [operation.key] });
  if (value.status !== 2) throw Error(`Pause not observable: ${operation.id}`);
  records.push({ id: operation.id, status: 'CONFIRMED_PAUSED', transactionHash: hash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, feeWei: String(receipt.gasUsed * receipt.effectiveGasPrice) });
  console.log(JSON.stringify({ id: operation.id, status: 'CONFIRMED_PAUSED', transactionHash: hash, blockNumber: String(receipt.blockNumber) }));
}

activation.status = 'REJECTED_AND_PAUSED';
activation.rejectionReason = 'Synthetic assets were deployed and admitted in error; only canonical Robinhood testnet assets may be used.';
activation.reasonHash = reasonHash;
activation.pauseTransactions = records;
activation.pausedAt = new Date().toISOString();
const temporary = `${activationPath}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(activation, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, activationPath);
console.log(JSON.stringify({ status: activation.status, paused: records.length, reasonHash }));
