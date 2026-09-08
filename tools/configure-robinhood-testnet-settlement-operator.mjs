import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';
import {createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../apps/web/node_modules/viem/_esm/accounts/index.js';

const root = new URL('../', import.meta.url).pathname;
const releaseId = process.env.TG_RH_RELEASE_ID ?? '0x7b2614a529d1d3a06e8826cf38329e211f134c69200acda3b9ced5d4791b4df0';
const directory = root + 'deployments/releases/' + releaseId;
const deployment = JSON.parse(fs.readFileSync(directory + '/robinhood-testnet-46630.v1.deployed.json'));
const treasury = JSON.parse(fs.readFileSync(root + 'deployments/manifests/robinhood-testnet-46630.test-treasury.json'));
const treasuryArtifact = JSON.parse(fs.readFileSync(root + 'contracts/out-v1/RobinhoodTestnetTreasury.sol/RobinhoodTestnetTreasury.json'));
const vaultArtifact = JSON.parse(fs.readFileSync(root + 'contracts/out-v1/ProtocolFeeVault.sol/ProtocolFeeVault.json'));
const feeVault = deployment.ordinaryComponents[15];
const local = readProjectEnv();
if (!local.ALCHEMY_API_KEY) throw Error('Missing ALCHEMY_API_KEY');
const isolated = releaseId === '0xf72a2cdf41ec88936213a0325a396df1a286a7a0254f649263f8ec624cb9c0bf';
const rpc = isolated ? 'http://127.0.0.1:18570' : `https://robinhood-testnet.g.alchemy.com/v2/${local.ALCHEMY_API_KEY}`;
const chain = defineChain({id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: [rpc]}}});
const client = createPublicClient({chain, transport: http(rpc, {timeout: 30_000, retryCount: 2})});
if (await client.getChainId() !== 46630) throw Error('Wrong chain');
const walletPath = '/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json';
const stat = fs.lstatSync(walletPath);
if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Unsafe wallet permissions');
const wallet = JSON.parse(fs.readFileSync(walletPath));
const account = privateKeyToAccount(wallet.privateKey);
if (account.address.toLowerCase() !== deployment.deployer.toLowerCase()) throw Error('Wrong signer');
const current = await client.readContract({address: feeVault, abi: vaultArtifact.abi, functionName: 'settlementOperator'});
const recordPath = directory + '/settlement-operator-configuration.json';
if (current.toLowerCase() === account.address.toLowerCase()) {
  console.log(JSON.stringify({status: 'ALREADY_CONFIGURED', feeVault, settlementOperator: current}));
  process.exit(0);
}
if (current.toLowerCase() !== treasury.address.toLowerCase()) throw Error('Unexpected current settlement operator');
let record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath)) : undefined;
if (!record) {
  const data = encodeFunctionData({abi: treasuryArtifact.abi, functionName: 'configureSettlementOperator', args: [feeVault, account.address]});
  const nonce = await client.getTransactionCount({address: account.address, blockTag: 'pending'});
  const gas = await client.estimateGas({account: account.address, to: treasury.address, data});
  const fees = isolated ? {gasPrice:(await client.getGasPrice())*2n} : await client.estimateFeesPerGas();
  const gasLimit = gas * 13n / 10n;
  if (gasLimit * (fees.gasPrice??fees.maxFeePerGas) > 1_000_000_000_000_000n) throw Error('Configuration exceeds 0.001 ETH cap');
  const signer = createWalletClient({account, chain, transport: http(rpc, {timeout: 30_000})});
  const prepared = await signer.prepareTransactionRequest({account, chain, to: treasury.address, data, nonce, gas: gasLimit, ...(isolated?{type:'legacy'}:{}), ...fees});
  const signed = await signer.signTransaction(prepared);
  record = {schemaVersion: 1, chainId: 46630, releaseId, action: 'CONFIGURE_SETTLEMENT_OPERATOR', treasury: treasury.address, feeVault, operator: account.address, nonce, transactionHash: keccak256(signed), status: 'SIGNED_INTENT'};
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
  await client.sendRawTransaction({serializedTransaction: signed});
  record.status = 'SUBMITTED'; fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
}
const receipt = await client.waitForTransactionReceipt({hash: record.transactionHash, confirmations: 2, timeout: 180_000});
if (receipt.status !== 'success') throw Error('Settlement operator configuration reverted');
const configured = await client.readContract({address: feeVault, abi: vaultArtifact.abi, functionName: 'settlementOperator'});
if (configured.toLowerCase() !== account.address.toLowerCase()) throw Error('Settlement operator verification failed');
record = {...record, status: 'CONFIRMED_VERIFIED', blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, gasUsed: String(receipt.gasUsed), effectiveGasPrice: String(receipt.effectiveGasPrice), feeWei: String(receipt.gasUsed * receipt.effectiveGasPrice)};
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', {mode: 0o600});
console.log(JSON.stringify(record, null, 2));
