import fs from 'node:fs';
import {requireAssetRiskReview} from './asset-risk-review.mjs';
import { createHash } from 'node:crypto';
import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters, encodeFunctionData,
  http, keccak256, toBytes,
} from '../apps/web/node_modules/viem/_esm/index.js';
import { privateKeyToAccount } from '../apps/web/node_modules/viem/_esm/accounts/index.js';

const mode = process.argv[2];
if (!['plan', 'audit', 'execute', 'verify'].includes(mode)) throw Error('usage: node tools/activate-robinhood-testnet-canonical-assets.mjs plan|audit|execute|verify');
const root = new URL('../', import.meta.url).pathname;
const releaseId = process.env.TG_RH_RELEASE_ID ?? '0x7b2614a529d1d3a06e8826cf38329e211f134c69200acda3b9ced5d4791b4df0';
const dir = `${root}deployments/releases/${releaseId}`;
const reviewPath = `${root}config/asset-risk-reviews.json`;
const paths = {
  plan: `${dir}/canonical-asset-activation-plan.json`, audit: `${dir}/canonical-asset-activation-audit.json`,
  activation: `${dir}/canonical-asset-activation.json`, evidence: `${dir}/canonical-test-assets.json`,
  pairedManifest: process.env.TG_RH_STAGED_ACTIVATION === "1" ? `${dir}/paired-assets.json` : `${root}deployments/manifests/robinhood-testnet-46630.paired-assets.json`,
  stockManifest: process.env.TG_RH_STAGED_ACTIVATION === "1" ? `${dir}/stock-assets.json` : `${root}deployments/manifests/robinhood-testnet-46630.stock-assets.json`,
};
const release = JSON.parse(fs.readFileSync(`${dir}/release-status.json`));
const coreActivation = JSON.parse(fs.readFileSync(`${dir}/activation.json`));
if (release.status !== 'DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY' || coreActivation.status !== 'ACTIVE_TEST_ONLY') throw Error('Core testnet release is not active');
const rpc = process.env.TG_RH_RPC_URL ?? 'http://127.0.0.1:18570';
if (rpc !== 'http://127.0.0.1:18570') throw Error('Use the budgeted integration gateway');
const stocksOnly = process.env.TG_RH_STOCKS_ONLY === '1';
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
if (await client.getChainId() !== 46630) throw Error('Wrong chain');
const artifact = name => JSON.parse(fs.readFileSync(`${root}contracts/out-v1/${name}.sol/${name}.json`));
const stockAbi = artifact('OfficialStockRegistryV1').abi;
const quoteAbi = artifact('ApprovedQuoteRegistry').abi;
const accessAbi = artifact('AccessManager').abi;
const components = release.components;
const json = (_key, value) => typeof value === 'bigint' ? String(value) : value;
const write = (path, value, mode) => { const tmp = `${path}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, json, 2)}\n`, mode ? { mode } : undefined); fs.renameSync(tmp, path); };
const ensure = (condition, message) => { if (!condition) throw Error(message); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const sha256 = path => `0x${createHash('sha256').update(fs.readFileSync(path)).digest('hex')}`;
const hashText = value => keccak256(toBytes(value));
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const ZERO32 = `0x${'0'.repeat(64)}`;
const faucet = '0x8762f93772c663c6a88ba50900bd5381df2717be';
const officialUsdG = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const stockAddresses = {
  TSLA: '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E', AMZN: '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
  PLTR: '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0', NFLX: '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
  AMD: '0x71178BAc73cBeb415514eB542a8995b82669778d',
};
const erc20Abi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'uid', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
];
const faucetAbi = [{ type: 'function', name: 'getFullTokenList', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] }];
const beaconAbi = [{ type: 'function', name: 'implementation', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }];
const productionAssets = JSON.parse(fs.readFileSync(`${root}deployments/manifests/robinhood-mainnet-4663.paired-assets.json`)).assets;
const productionEconomics = symbol => { const row = productionAssets.find(asset => asset.symbol === symbol); ensure(row, `Missing production economics: ${symbol}`); return { phantomQuote: BigInt(row.phantomQuote) / 10n, graduationThreshold: BigInt(row.graduationThreshold) / 10n }; };

async function observe() {
  const block = await client.getBlock();
  const faucetList = stocksOnly ? Object.values(stockAddresses) : await client.readContract({ address: faucet, abi: faucetAbi, functionName: 'getFullTokenList' });
  const stocks = [];
  const proxies = new Map();
  for (const [expectedSymbol, address] of Object.entries(stockAddresses)) {
    ensure(faucetList.some(item => same(item, address)), `${expectedSymbol} is not in canonical faucet list`);
    const [code, name, symbol, decimals, uid, balance, slot] = await Promise.all([
      client.getCode({ address }), client.readContract({ address, abi: erc20Abi, functionName: 'name' }),
      client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }), client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
      client.readContract({ address, abi: erc20Abi, functionName: 'uid' }),
      client.readContract({ address, abi: erc20Abi, functionName: 'balanceOf', args: [release.deployer] }),
      client.getStorageAt({ address, slot: BEACON_SLOT }),
    ]);
    ensure(code && symbol === expectedSymbol && decimals === 18 && uid !== ZERO32 && slot && slot !== ZERO32, `Invalid canonical stock identity: ${expectedSymbol}`);
    const beacon = `0x${slot.slice(-40)}`;
    let proxy = proxies.get(beacon);
    if (!proxy) {
      const implementation = await client.readContract({ address: beacon, abi: beaconAbi, functionName: 'implementation' });
      const [beaconCode, implementationCode] = await Promise.all([client.getCode({ address: beacon }), client.getCode({ address: implementation })]);
      ensure(beaconCode && implementationCode, `Missing proxy code: ${expectedSymbol}`);
      proxy = { implementation, beaconCode, implementationCode }; proxies.set(beacon, proxy);
    }
    const { implementation, beaconCode, implementationCode } = proxy;
    stocks.push({ symbol, name, address, decimals, uid, deployerBalance: String(balance), fingerprint: { tokenRuntimeCodeHash: keccak256(code), beacon, beaconRuntimeCodeHash: keccak256(beaconCode), implementation, implementationRuntimeCodeHash: keccak256(implementationCode) }, ...productionEconomics(symbol) });
  }
  if (stocksOnly) return { block: { number: String(block.number), hash: block.hash, timestamp: String(block.timestamp) }, faucetList, stocks };
  const [usdCode, usdName, usdSymbol, usdDecimals, usdBalance] = await Promise.all([
    client.getCode({ address: officialUsdG }), client.readContract({ address: officialUsdG, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address: officialUsdG, abi: erc20Abi, functionName: 'symbol' }), client.readContract({ address: officialUsdG, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: officialUsdG, abi: erc20Abi, functionName: 'balanceOf', args: [release.deployer] }),
  ]);
  ensure(usdCode && usdName === 'Global Dollar' && usdSymbol === 'USDG' && usdDecimals === 6, 'Invalid Paxos USDG identity');
  return { block: { number: String(block.number), hash: block.hash, timestamp: String(block.timestamp) }, faucetList, stocks, usdG: { symbol: usdSymbol, name: usdName, address: officialUsdG, decimals: usdDecimals, runtimeCodeHash: keccak256(usdCode), deployerBalance: String(usdBalance), ...productionEconomics('USDG') } };
}

const fingerprintHash = stock => keccak256(encodeAbiParameters([
  { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' },
], [hashText('TICKERGARDEN_V1_STOCK_QUOTE_FINGERPRINT'), 1n, 46630n, stock.uid, stock.address, stock.decimals, stock.fingerprint.tokenRuntimeCodeHash, stock.fingerprint.beacon, stock.fingerprint.beaconRuntimeCodeHash, stock.fingerprint.implementation, stock.fingerprint.implementationRuntimeCodeHash]));
const stockConfigId = (stock, binding) => keccak256(encodeAbiParameters([
  { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' },
], [hashText('TICKERGARDEN_V1_STOCK_QUOTE_ECONOMICS'), 1n, 46630n, coreActivation.baselineId, stock.address, stock.decimals, stock.phantomQuote, stock.graduationThreshold, binding.assetUid, binding.stockTokenFingerprintHash, binding.referenceEvidenceHash, binding.generatorPolicyId]));
const erc20ConfigId = quote => keccak256(encodeAbiParameters([
  { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' },
], [hashText('TICKERGARDEN_V1_QUOTE_ECONOMICS'), 1n, 46630n, coreActivation.baselineId, quote.address, quote.decimals, quote.phantomQuote, quote.graduationThreshold]));

function reviewedAssets(observed) {
  const reviews=JSON.parse(fs.readFileSync(reviewPath));
  const stocks=observed.stocks.map(stock=>{
    const review=requireAssetRiskReview(reviews,{...stock,chainId:46630,roles:['staking','quote']});
    return {...stock,minimumAllocation:BigInt(review.minimumAllocationRaw)};
  });
  if (!stocksOnly) requireAssetRiskReview(reviews,{...observed.usdG,chainId:46630,roles:['quote']});
  return {...observed,stocks};
}

async function buildPlan() {
  const observed = reviewedAssets(await observe());
  const nonce = await client.getTransactionCount({ address: release.deployer, blockTag: 'pending' });
  const referenceEvidenceHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }], [hashText('TICKERGARDEN_RH_TESTNET_CANONICAL_FAUCET_EVIDENCE'), 46630n, faucet, observed.block.hash]));
  const generatorPolicyId = hashText('TICKERGARDEN_RH_TESTNET_CANONICAL_ASSET_CONFIG_V1');
  const transactions = [];
  const stocks = observed.stocks.map(stock => {
    const binding = { assetUid: stock.uid, stockTokenFingerprintHash: fingerprintHash(stock), referenceEvidenceHash, generatorPolicyId };
    const configId = stockConfigId(stock, binding);
    transactions.push({ id: `register-${stock.symbol.toLowerCase()}-staking`, to: components.OfficialStockRegistryV1, data: encodeFunctionData({ abi: stockAbi, functionName: 'registerAsset', args: [stock.uid, stock.address, stock.decimals, components.UserStockVault, stock.minimumAllocation, stock.fingerprint] }), value: '0' });
    return { ...stock, minimumAllocation: stock.minimumAllocation, binding, configId };
  });
  const usdConfigId = stocksOnly ? null : erc20ConfigId(observed.usdG);
  if (!stocksOnly) transactions.push({ id: 'add-usdg-quote', to: components.ApprovedQuoteRegistry, data: encodeFunctionData({ abi: quoteAbi, functionName: 'addQuoteConfig', args: [usdConfigId, { tickerGardenBaselineId: coreActivation.baselineId, quoteAsset: observed.usdG.address, quoteDecimals: observed.usdG.decimals, phantomQuote: observed.usdG.phantomQuote, graduationThreshold: observed.usdG.graduationThreshold, economicsHash: usdConfigId, status: 1 }] }), value: '0' });
  for (const stock of stocks) transactions.push({ id: `add-${stock.symbol.toLowerCase()}-quote`, to: components.ApprovedQuoteRegistry, data: encodeFunctionData({ abi: quoteAbi, functionName: 'addStockQuoteConfig', args: [stock.configId, { tickerGardenBaselineId: coreActivation.baselineId, quoteAsset: stock.address, quoteDecimals: stock.decimals, phantomQuote: stock.phantomQuote, graduationThreshold: stock.graduationThreshold, economicsHash: stock.configId, status: 1 }, stock.binding] }), value: '0' });
  transactions.forEach((tx, i) => { tx.nonce = nonce + i; tx.inputHash = keccak256(tx.data); });
  const evidence = { schemaVersion: 1, status: 'OBSERVED_CANONICAL_TEST_ASSETS', chainId: 46630, auditBlock: observed.block, wallet: release.deployer, walletBalances: { officialUsdG: observed.usdG?.deployerBalance, officialStocks: stocks.map(stock => ({ symbol: stock.symbol, address: stock.address, balanceRaw: stock.deployerBalance })) }, sources: { paxosUsdG: 'https://docs.paxos.com/guides/stablecoin/usdg/testnet', robinhoodExplorer: 'https://explorer.testnet.chain.robinhood.com', canonicalFaucet: faucet }, faucetTokenList: observed.faucetList, usdG: observed.usdG, stocks };
  write(paths.evidence, evidence);
  const plan = { schemaVersion: 1, status: 'PLANNED_FOR_REVIEW', scope: 'ROBINHOOD_TESTNET_CANONICAL_ASSETS', chainId: 46630, releaseId, deployer: release.deployer, auditBlock: observed.block, expiresAtUnix: Number(observed.block.timestamp) + 86_400, baselineId: coreActivation.baselineId, usdG: { ...observed.usdG, configId: usdConfigId }, stocks, transactions, sourceHashes: { assetRiskReviews: sha256(reviewPath), evidence: sha256(paths.evidence), releaseStatus: sha256(`${dir}/release-status.json`) }, limits: { perTransactionMaximumWei: '5000000000000000', totalMaximumWei: '30000000000000000' }, limitations: ['Canonical testnet addresses are pinned to the Paxos USDG documentation and the onchain RH testnet faucet list.', 'The deployer currently has zero canonical USDG balance; quote admission does not mint or transfer USDG.', 'NVDA and AAPL are absent from the canonical faucet list observed at the audit block and are excluded.'] };
  write(paths.plan, plan);
  console.log(JSON.stringify({ status: plan.status, assets: [...(stocksOnly ? [] : ['USDG']), ...stocks.map(row => row.symbol)], transactions: transactions.length, officialUsdGBalance: observed.usdG?.deployerBalance }));
}

async function auditPlan() {
  const plan = JSON.parse(fs.readFileSync(paths.plan));
  ensure(plan.sourceHashes.assetRiskReviews === sha256(reviewPath), 'Asset reviews changed; regenerate the admission plan');
  reviewedAssets(plan);
  ensure(plan.status === 'PLANNED_FOR_REVIEW' && plan.scope === 'ROBINHOOD_TESTNET_CANONICAL_ASSETS' && plan.sourceHashes.evidence === sha256(paths.evidence), 'Invalid or changed plan');
  ensure(Date.now() / 1000 <= plan.expiresAtUnix && plan.transactions.length === (stocksOnly ? 10 : 11) && plan.stocks.length === 5, 'Plan expired or wrong scope');
  for (const stock of plan.stocks) {
    const existing = await client.readContract({ address: components.OfficialStockRegistryV1, abi: stockAbi, functionName: 'asset', args: [stock.uid] });
    ensure(existing.status === 0, `Stock UID already registered: ${stock.symbol}`);
  }
  if (!stocksOnly) {
    const usdExisting = await client.readContract({ address: components.ApprovedQuoteRegistry, abi: quoteAbi, functionName: 'quoteConfig', args: [plan.usdG.configId] });
    ensure(usdExisting.status === 0, 'USDG quote already registered');
  }
  for (const stock of plan.stocks) { const existing = await client.readContract({ address: components.ApprovedQuoteRegistry, abi: quoteAbi, functionName: 'quoteConfig', args: [stock.configId] }); ensure(existing.status === 0, `Stock quote already registered: ${stock.symbol}`); }
  const permissions = new Set();
  for (const tx of plan.transactions) {
    ensure(tx.value === '0' && tx.inputHash === keccak256(tx.data), `Transaction commitment mismatch: ${tx.id}`);
    const permissionKey = tx.to + tx.data.slice(0, 10);
    if (permissions.has(permissionKey)) continue;
    permissions.add(permissionKey);
    const permission = await client.readContract({ address: components.AccessManager, abi: accessAbi, functionName: 'canCall', args: [release.deployer, tx.to, tx.data.slice(0, 10)] });
    ensure(permission[0] && permission[1] === 0, `Deployer cannot call ${tx.id}`);
  }
  ensure(await client.getBalance({ address: release.deployer }) >= 30_000_000_000_000_000n, 'Require at least 0.03 test ETH');
  const audit = { schemaVersion: 1, status: 'APPROVED_FOR_CANONICAL_TEST_ASSET_ACTIVATION', scope: plan.scope, chainId: 46630, releaseId, planSha256: sha256(paths.plan), evidenceSha256: sha256(paths.evidence), auditBlock: String((await client.getBlock()).number), expiresAtUnix: plan.expiresAtUnix, transactionCount: plan.transactions.length, reviewer: 'AUTOMATED_FAIL_CLOSED_REVIEW' };
  write(paths.audit, audit); console.log(JSON.stringify({ status: audit.status, transactionCount: audit.transactionCount, planSha256: audit.planSha256 }));
}

async function executePlan() {
  const plan = JSON.parse(fs.readFileSync(paths.plan)); const audit = JSON.parse(fs.readFileSync(paths.audit));
  ensure(audit.status === 'APPROVED_FOR_CANONICAL_TEST_ASSET_ACTIVATION' && audit.planSha256 === sha256(paths.plan) && Date.now() / 1000 <= audit.expiresAtUnix, 'Plan is not approved or expired');
  ensure(plan.sourceHashes.assetRiskReviews === sha256(reviewPath), 'Asset reviews changed; regenerate the admission plan');
  reviewedAssets(plan);
  const walletPath = '/Users/dear/.config/tickergarden/testnet-wallets/arbitrum-sepolia.json'; const stat = fs.lstatSync(walletPath); ensure(!stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'Wallet file permissions are unsafe');
  const account = privateKeyToAccount(JSON.parse(fs.readFileSync(walletPath)).privateKey); ensure(same(account.address, release.deployer), 'Wrong signer');
  const wallet = createWalletClient({ account, chain, transport: http(rpc, { timeout: 30_000 }) });
  const activation = fs.existsSync(paths.activation) ? JSON.parse(fs.readFileSync(paths.activation)) : { schemaVersion: 1, status: 'BROADCAST_IN_PROGRESS', scope: plan.scope, chainId: 46630, releaseId, planSha256: audit.planSha256, transactions: [] };
  ensure(activation.releaseId === releaseId && activation.planSha256 === audit.planSha256, 'Activation intent belongs to another plan');
  let total = activation.transactions.filter(tx => tx.status === 'CONFIRMED').reduce((sum, tx) => sum + BigInt(tx.feeWei), 0n);
  for (const planned of plan.transactions) {
    let record = activation.transactions.find(tx => tx.id === planned.id);
    if (!record) {
      ensure(await client.getTransactionCount({ address: account.address, blockTag: 'pending' }) === planned.nonce, `Pending nonce drift before ${planned.id}`);
      const request = { account, chain, to: planned.to, data: planned.data, value: 0n, nonce: planned.nonce };
      const estimate = await client.estimateGas(request); const fees = await client.estimateFeesPerGas(); const gas = estimate * 13n / 10n; const maxFee = fees.maxFeePerGas ?? fees.gasPrice;
      ensure(gas * maxFee <= BigInt(plan.limits.perTransactionMaximumWei) && total + gas * maxFee <= BigInt(plan.limits.totalMaximumWei), `Gas cap exceeded: ${planned.id}`);
      const prepared = await wallet.prepareTransactionRequest({ ...request, gas, ...fees }); const signed = await wallet.signTransaction(prepared); const hash = keccak256(signed);
      record = { id: planned.id, nonce: planned.nonce, to: planned.to, inputHash: planned.inputHash, transactionHash: hash, status: 'SIGNED_INTENT' }; activation.transactions.push(record); write(paths.activation, activation, 0o600);
      await client.sendRawTransaction({ serializedTransaction: signed }); record.status = 'SUBMITTED'; write(paths.activation, activation, 0o600);
    }
    if (record.status !== 'CONFIRMED') {
      const receipt = await pollReceipt(record.transactionHash); const tx = { from: receipt.from, to: receipt.to, nonce: record.nonce, input: planned.data };
      ensure(receipt.transactionHash === record.transactionHash && record.inputHash === planned.inputHash, 'Receipt intent mismatch');
      ensure(receipt.status === 'success' && same(tx.from, release.deployer) && same(tx.to, planned.to) && tx.nonce === planned.nonce && keccak256(tx.input) === planned.inputHash, `Receipt verification failed: ${planned.id}`);
      record.status = 'CONFIRMED'; record.blockNumber = String(receipt.blockNumber); record.blockHash = receipt.blockHash; record.logs = receipt.logs; record.transactionIndex = receipt.transactionIndex; record.gasUsed = String(receipt.gasUsed); record.effectiveGasPrice = String(receipt.effectiveGasPrice); record.feeWei = String(receipt.gasUsed * receipt.effectiveGasPrice); total += receipt.gasUsed * receipt.effectiveGasPrice; write(paths.activation, activation, 0o600);
    }
    console.log(JSON.stringify({ id: planned.id, status: record.status, transactionHash: record.transactionHash, blockNumber: record.blockNumber }));
  }
  activation.status = 'ACTIVE_TEST_ONLY'; activation.totalFeeWei = String(total); activation.observedAt = new Date().toISOString(); write(paths.activation, activation, 0o600); await verify(plan, activation);
}

async function verify(plan = JSON.parse(fs.readFileSync(paths.plan)), activation = JSON.parse(fs.readFileSync(paths.activation))) {
  ensure(activation.status === 'ACTIVE_TEST_ONLY', 'Activation incomplete');
  for (const stock of plan.stocks) {
    const [asset, current, quote, quoteCurrent, binding] = await Promise.all([
      client.readContract({ address: components.OfficialStockRegistryV1, abi: stockAbi, functionName: 'asset', args: [stock.uid] }), client.readContract({ address: components.OfficialStockRegistryV1, abi: stockAbi, functionName: 'assetIdentityCurrent', args: [stock.uid] }),
      client.readContract({ address: components.ApprovedQuoteRegistry, abi: quoteAbi, functionName: 'quoteConfig', args: [stock.configId] }), client.readContract({ address: components.ApprovedQuoteRegistry, abi: quoteAbi, functionName: 'quoteIdentityCurrent', args: [stock.configId] }),
      client.readContract({ address: components.ApprovedQuoteRegistry, abi: quoteAbi, functionName: 'stockQuoteBinding', args: [stock.configId] }),
    ]);
    ensure(asset.status === 1 && same(asset.stockToken, stock.address) && current && quote.status === 1 && same(quote.quoteAsset, stock.address) && quoteCurrent && binding.assetUid === stock.uid, `Canonical stock activation failed: ${stock.symbol}`);
  }
  if (!stocksOnly) { const usd = await client.readContract({ address: components.ApprovedQuoteRegistry, abi: quoteAbi, functionName: 'quoteConfig', args: [plan.usdG.configId] }); const usdCurrent = await client.readContract({ address: components.ApprovedQuoteRegistry, abi: quoteAbi, functionName: 'quoteIdentityCurrent', args: [plan.usdG.configId] }); ensure(usd.status === 1 && same(usd.quoteAsset, plan.usdG.address) && usdCurrent, 'Canonical USDG activation failed'); }
  const existing = JSON.parse(fs.readFileSync(paths.pairedManifest)); const existingNative = existing.assets.find(asset => asset.symbol === 'ETH'); ensure(existingNative, 'Native quote missing');
  const native = { symbol: 'ETH', name: 'Ether', chainId: 46630, tokenAddress: '0x0000000000000000000000000000000000000000', decimals: 18, assetKind: 'NATIVE', assetUid: null, officialStatus: null, currentMultiplier: null, pendingMultiplier: null, quoteAssetConfigId: existingNative.quoteAssetConfigId, phantomQuote: existingNative.phantomQuote, graduationThreshold: existingNative.graduationThreshold, includedInRelease: true, activationStatus: 'REGISTRY_ACTIVE', runtimeCodeHash: null, proxySlots: null, admissionPath: 'ADMIN_REVIEWED_WHITELIST' };
  const quoteRows = [...(stocksOnly ? [] : [plan.usdG]), ...plan.stocks].map(asset => ({ symbol: asset.symbol, name: asset.name, chainId: 46630, tokenAddress: asset.address.toLowerCase(), decimals: asset.decimals, assetKind: asset.symbol === 'USDG' ? 'ERC20' : 'OFFICIAL_STOCK', assetUid: asset.uid ?? null, officialStatus: asset.symbol === 'USDG' ? null : 'TESTNET_FAUCET_ACTIVE', currentMultiplier: null, pendingMultiplier: null, quoteAssetConfigId: asset.configId, phantomQuote: String(asset.phantomQuote), graduationThreshold: String(asset.graduationThreshold), includedInRelease: true, activationStatus: 'REGISTRY_ACTIVE', runtimeCodeHash: asset.runtimeCodeHash ?? asset.fingerprint.tokenRuntimeCodeHash, proxySlots: asset.symbol === 'USDG' ? null : { beacon: asset.fingerprint.beacon, implementation: asset.fingerprint.implementation }, admissionPath: 'ADMIN_REVIEWED_WHITELIST' }));
  write(paths.pairedManifest, { ...existing, status: 'REGISTRY_ACTIVE', assets: [native, ...quoteRows], limitations: ['Canonical USDG is sourced from Paxos testnet documentation.', 'Canonical Stock Tokens are pinned to the onchain RH testnet faucet list and shared beacon identity.', 'NVDA and AAPL are unavailable in the observed faucet list and are excluded.'], observedAt: activation.observedAt });
  write(paths.stockManifest, { schemaVersion: 1, status: 'REGISTRY_ACTIVE', networkScope: 'ROBINHOOD_TESTNET_ONLY', chainId: 46630, releaseId, officialStockRegistry: components.OfficialStockRegistryV1, userStockVault: components.UserStockVault, canonicalFaucet: faucet, assets: plan.stocks.map(stock => ({ symbol: stock.symbol, name: stock.name, assetUid: stock.uid, tokenAddress: stock.address.toLowerCase(), decimals: stock.decimals, minimumAllocation: String(stock.minimumAllocation), fingerprint: stock.fingerprint, quoteAssetConfigId: stock.configId, status: 'REGISTRY_ACTIVE' })), observedAt: activation.observedAt });
  console.log(JSON.stringify({ status: 'VERIFIED_ACTIVE_TEST_ONLY', quotes: ['ETH', ...(stocksOnly ? [] : ['USDG']), ...plan.stocks.map(row => row.symbol)], staking: plan.stocks.map(row => row.symbol), totalFeeWei: activation.totalFeeWei }));
}

async function pollReceipt(hash) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const r = await client.request({method:'eth_getTransactionReceipt',params:[hash]});
    if (r) return {...r,status:r.status==='0x1'?'success':'reverted',blockNumber:BigInt(r.blockNumber),gasUsed:BigInt(r.gasUsed),effectiveGasPrice:BigInt(r.effectiveGasPrice),transactionIndex:Number(BigInt(r.transactionIndex))};
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
  throw Error('Receipt pending; resume this same intent, do not resubmit');
}

if (mode === 'plan') await buildPlan();
if (mode === 'audit') await auditPlan();
if (mode === 'execute') await executePlan();
if (mode === 'verify') await verify();
