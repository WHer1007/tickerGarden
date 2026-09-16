import fs from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  getContractAddress,
  http,
  keccak256,
} from '../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';

const root = new URL('../', import.meta.url).pathname;
const mode = process.argv[2] ?? 'check';
if (!['check', 'broadcast'].includes(mode)) throw Error('Use check or broadcast');

const readEnv = (path) => Object.fromEntries(
  fs.readFileSync(path, 'utf8').split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }),
);
const local = readEnv(root + '.env');
if (!local.ALCHEMY_API_KEY) throw Error('Missing ALCHEMY_API_KEY in root .env');
const rpc = `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`;
const chain = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: [rpc]}},
});
const publicClient = createPublicClient({chain, transport: http(rpc, {timeout: 30_000, retryCount: 2})});
if (await publicClient.getChainId() !== 46630) throw Error('Wrong network');

const walletPath = '/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';
const stat = fs.lstatSync(walletPath);
if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Unsafe wallet permissions');
const wallet = JSON.parse(fs.readFileSync(walletPath));
const account = privateKeyToAccount(wallet.privateKey);
if (account.address.toLowerCase() !== '0xa6c3298a5559544c3b4cf8e6dc5f349f4be524ea') throw Error('Unexpected signer');

const artifact = JSON.parse(fs.readFileSync(root + 'contracts/out-v1/RobinhoodTestnetTreasury.sol/RobinhoodTestnetTreasury.json'));
const recordPath = root + 'deployments/manifests/robinhood-testnet-46630.test-treasury.json';
let record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath)) : undefined;
if (!record) {
  const nonce = await publicClient.getTransactionCount({address: account.address, blockTag: 'pending'});
  const data = encodeDeployData({abi: artifact.abi, bytecode: artifact.bytecode.object, args: [account.address]});
  const gas = await publicClient.estimateGas({account: account.address, data});
  const fees = await publicClient.estimateFeesPerGas();
  const gasLimit = (gas * 13n + 9n) / 10n;
  const maxCost = gasLimit * fees.maxFeePerGas;
  if (maxCost > 5_000_000_000_000_000n) throw Error('Treasury deployment exceeds 0.005 ETH cap');
  if (maxCost > await publicClient.getBalance({address: account.address})) throw Error('Insufficient balance');
  console.log(JSON.stringify({stage: 'estimated', chainId: 46630, signer: account.address, nonce, gas: String(gas), gasLimit: String(gasLimit), maxCostWei: String(maxCost)}));
  if (mode === 'check') process.exit(0);
  const signer = createWalletClient({account, chain, transport: http(rpc, {timeout: 30_000})});
  const prepared = await signer.prepareTransactionRequest({account, chain, data, nonce, gas: gasLimit, ...fees});
  const signed = await signer.signTransaction(prepared);
  const hash = keccak256(signed);
  record = {
    schemaVersion: 1,
    chainId: 46630,
    scope: 'ROBINHOOD_TESTNET_ONLY',
    owner: account.address,
    address: getContractAddress({from: account.address, nonce: BigInt(nonce)}),
    transactionHash: hash,
    status: 'SIGNED_INTENT',
  };
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
  await publicClient.sendRawTransaction({serializedTransaction: signed});
  record.status = 'SUBMITTED';
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
}

const receipt = await publicClient.waitForTransactionReceipt({hash: record.transactionHash, confirmations: 2, timeout: 180_000});
if (receipt.status !== 'success') throw Error('Treasury deployment reverted');
const [code, owner] = await Promise.all([
  publicClient.getCode({address: record.address}),
  publicClient.readContract({address: record.address, abi: artifact.abi, functionName: 'owner'}),
]);
if (!code || code === '0x' || owner.toLowerCase() !== account.address.toLowerCase()) throw Error('Treasury verification failed');
const normalized = Buffer.from(code.slice(2), 'hex');
for (const ranges of Object.values(artifact.deployedBytecode.immutableReferences ?? {})) {
  for (const range of ranges) normalized.fill(0, range.start, range.start + range.length);
}
if (normalized.toString('hex') !== artifact.deployedBytecode.object.slice(2)) throw Error('Treasury runtime differs from current artifact');
record = {
  ...record,
  status: 'DEPLOYED_VERIFIED',
  runtimeCodeHash: keccak256(code),
  blockNumber: String(receipt.blockNumber),
  blockHash: receipt.blockHash,
  gasUsed: String(receipt.gasUsed),
  effectiveGasPrice: String(receipt.effectiveGasPrice),
  feeWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
};
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
console.log(JSON.stringify(record, null, 2));
