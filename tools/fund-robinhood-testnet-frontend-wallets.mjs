import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';
import {
  createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatEther,
  formatUnits, http, keccak256, parseEther, parseUnits,
} from '../apps/web/node_modules/viem/_esm/index.js';
import { privateKeyToAccount } from '../apps/web/node_modules/viem/_esm/accounts/index.js';

const root = new URL('../', import.meta.url).pathname;
const chainId = 46630;
const sourceAddress = '0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea';
const sourceWalletPath = '/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';
const rolesPath = '/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia-r3-roles.json';
const outputPath = `${root}deployments/evidence/robinhood-testnet-frontend-wallet-funding.json`;
const stockManifest = JSON.parse(fs.readFileSync(`${root}deployments/manifests/robinhood-testnet-46630.stock-assets.json`));
const env = readProjectEnv();
if (!env.ALCHEMY_API_KEY) throw Error('Missing ALCHEMY_API_KEY');
for (const path of [sourceWalletPath, rolesPath]) {
  const stat = fs.lstatSync(path);
  if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error(`Unsafe wallet file permissions: ${path}`);
}
const source = privateKeyToAccount(JSON.parse(fs.readFileSync(sourceWalletPath)).privateKey);
if (source.address.toLowerCase() !== sourceAddress.toLowerCase()) throw Error('Unexpected source signer');
const roles = JSON.parse(fs.readFileSync(rolesPath)).roles;
const recipients = [
  { role: 'buyer', address: roles.buyer.address },
  { role: 'staker', address: roles.staker.address },
];
if (new Set(recipients.map(row => row.address.toLowerCase())).size !== recipients.length || recipients.some(row => row.address.toLowerCase() === sourceAddress.toLowerCase())) throw Error('Invalid recipient set');

const rpc = `https://robinhood-testnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
const chain = defineChain({ id: chainId, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
const wallet = createWalletClient({ account: source, chain, transport: http(rpc, { timeout: 30_000 }) });
if (await client.getChainId() !== chainId) throw Error('Wrong chain');
const transferAbi = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }];
const balanceAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];
const desiredEth = parseEther('0.02');
const desiredStock = parseUnits('1', 18);
const before = {};
const planned = [];
for (const recipient of recipients) {
  const eth = await client.getBalance({ address: recipient.address });
  before[recipient.role] = { address: recipient.address, ETH: eth.toString(), stocks: {} };
  if (eth < desiredEth) planned.push({ id: `${recipient.role}-eth`, role: recipient.role, asset: 'ETH', to: recipient.address, value: desiredEth - eth, data: '0x' });
  for (const asset of stockManifest.assets) {
    const balance = await client.readContract({ address: asset.tokenAddress, abi: balanceAbi, functionName: 'balanceOf', args: [recipient.address] });
    before[recipient.role].stocks[asset.symbol] = balance.toString();
    if (balance < desiredStock) planned.push({
      id: `${recipient.role}-${asset.symbol.toLowerCase()}`, role: recipient.role, asset: asset.symbol,
      token: asset.tokenAddress, to: asset.tokenAddress, value: 0n,
      data: encodeFunctionData({ abi: transferAbi, functionName: 'transfer', args: [recipient.address, desiredStock - balance] }),
      amount: desiredStock - balance,
    });
  }
}
const requiredByToken = new Map();
for (const row of planned.filter(row => row.token)) requiredByToken.set(row.token, (requiredByToken.get(row.token) ?? 0n) + row.amount);
for (const [token, amount] of requiredByToken) {
  const balance = await client.readContract({ address: token, abi: balanceAbi, functionName: 'balanceOf', args: [source.address] });
  if (balance < amount) throw Error(`Insufficient source token balance: ${token}`);
}
const pendingNonce = await client.getTransactionCount({ address: source.address, blockTag: 'pending' });
const record = { schemaVersion: 1, status: 'BROADCAST_IN_PROGRESS', chainId, source: source.address, recipients, targets: { ETH: desiredEth.toString(), eachOfficialStock: desiredStock.toString() }, before, transactions: [] };
fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
let nonce = pendingNonce;
for (const row of planned) {
  const request = { account: source, chain, to: row.to, data: row.data, value: row.value, nonce };
  const estimate = await client.estimateGas(request); const fees = await client.estimateFeesPerGas(); const gas = estimate * 13n / 10n;
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (gas * maxFeePerGas > 1_000_000_000_000_000n) throw Error(`Per-transaction gas cap exceeded: ${row.id}`);
  const prepared = await wallet.prepareTransactionRequest({ ...request, gas, ...fees }); const signed = await wallet.signTransaction(prepared); const hash = keccak256(signed);
  const txRecord = { id: row.id, role: row.role, asset: row.asset, recipient: recipients.find(item => item.role === row.role).address, amountRaw: String(row.amount ?? row.value), nonce, hash, status: 'SIGNED_INTENT' };
  record.transactions.push(txRecord); fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await client.sendRawTransaction({ serializedTransaction: signed }); txRecord.status = 'SUBMITTED'; fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 180_000 });
  if (receipt.status !== 'success') throw Error(`Funding transaction reverted: ${row.id}`);
  txRecord.status = 'CONFIRMED'; txRecord.blockNumber = String(receipt.blockNumber); txRecord.blockHash = receipt.blockHash; txRecord.feeWei = String(receipt.gasUsed * receipt.effectiveGasPrice);
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }); console.log(JSON.stringify({ id: row.id, status: txRecord.status, hash, blockNumber: txRecord.blockNumber })); nonce += 1;
}
const after = {};
for (const recipient of recipients) {
  const eth = await client.getBalance({ address: recipient.address }); after[recipient.role] = { address: recipient.address, ETH: eth.toString(), stocks: {} };
  for (const asset of stockManifest.assets) after[recipient.role].stocks[asset.symbol] = String(await client.readContract({ address: asset.tokenAddress, abi: balanceAbi, functionName: 'balanceOf', args: [recipient.address] }));
  if (eth < desiredEth || Object.values(after[recipient.role].stocks).some(value => BigInt(value) < desiredStock)) throw Error(`Recipient verification failed: ${recipient.role}`);
}
record.status = 'CONFIRMED_VERIFIED'; record.after = after; record.observedAt = new Date().toISOString(); record.transactionCount = record.transactions.length;
fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: record.status, transactionCount: record.transactionCount, recipients: Object.fromEntries(Object.entries(after).map(([role, state]) => [role, { address: state.address, ETH: formatEther(BigInt(state.ETH)), stocks: Object.fromEntries(Object.entries(state.stocks).map(([symbol, value]) => [symbol, formatUnits(BigInt(value), 18)])) }])) }, null, 2));
