throw new Error('Archived environment-writing workflow. Use the root .env.test.local and tools/environment.mjs; no per-service configuration may be generated.');
import {readProjectEnv} from "./environment.mjs";
import fs from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const releaseId = '0xf7024d03f3844c5b40abfeda80cb4e8c6edc307ba60a17c8c6d2bc9296e26e41';
const releaseDirectory = root + 'deployments/releases/' + releaseId;
const detail = JSON.parse(fs.readFileSync(releaseDirectory + '/robinhood-testnet-46630.v1.deployed.json'));
const plan = JSON.parse(fs.readFileSync(releaseDirectory + '/activation-plan.json'));
const activation = JSON.parse(fs.readFileSync(releaseDirectory + '/activation.json'));
const preflight = JSON.parse(fs.readFileSync(root + 'outputs/reviews/robinhood-testnet-continuous-2026-09-08/chain-preflight.json'));
const rootEnv = readProjectEnv();
if (detail.status !== 'DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY' || activation.status !== 'ACTIVE_TEST_ONLY' || !rootEnv.ALCHEMY_API_KEY) throw Error('Active release or local RPC key unavailable');

const runtimeNames = new Map(detail.contracts.map((contract) => [contract.name, contract]));
const bindings = [
  ['OfficialStockRegistryV1', 'OfficialStockRegistryV1'],
  ['ApprovedQuoteRegistry', 'ApprovedQuoteRegistry'],
  ['TickerGardenBaselineRegistry', 'TickerGardenBaselineRegistry'],
  ['LaunchTemplateRegistry', 'LaunchTemplateRegistry'],
  ['LaunchConfigResolver', 'LaunchConfigResolver'],
  ['MemeStockGauge', 'MemeStockGauge'],
  ['LaunchAndBuyRouter', 'LaunchAndBuyRouter'],
  ['MarketRegistryV1', 'MarketRegistryV1'],
  ['CreatorRevenueRegistry', 'CreatorRevenueRegistry'],
  ['AllocationManager', 'AllocationManager'],
  ['UserStockVault', 'UserStockVault'],
  ['HolderRewardsDistributorV1', 'HolderRewardsDistributorV1'],
  ['ProtocolFeeVault', 'ProtocolFeeVault'],
  ['TickerGardenMemeHook', 'TickerGardenMemeHook'],
  ['GraduationExecutor', 'GraduationExecutor'],
  ['TickerGardenFactoryV1', 'TickerGardenFactoryV1'],
];
const contracts = bindings.map(([module, name]) => {
  const contract = runtimeNames.get(name);
  if (!contract) throw Error(`Missing deployed runtime: ${name}`);
  return {module, address: contract.address.toLowerCase(), runtimeCodeHash: contract.runtimeCodeHash.toLowerCase()};
});
const poolManager = preflight.dependencies.find((dependency) => dependency.name === 'POOL_MANAGER');
if (!poolManager) throw Error('Missing verified testnet PoolManager dependency');
contracts.push({module: 'UniswapV4PoolManager', address: poolManager.address.toLowerCase(), runtimeCodeHash: poolManager.codeHash.toLowerCase()});
const backendManifest = {executionSpecId: 'V1-EXEC-11', chainId: 46630, genesisHash: plan.genesisHash.toLowerCase(), contracts};
const manifestPath = releaseDirectory + '/backend-deployment-manifest.json';
fs.writeFileSync(manifestPath, JSON.stringify(backendManifest, null, 2) + '\n');

// The first activation transaction is the earliest block that can affect test
// business configuration; earlier deployment-only blocks contain no user state.
const startBlock = activation.transactions[0]?.blockNumber;
if (!/^\d+$/.test(startBlock ?? '')) throw Error('Missing activation start block');
const database = 'postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden?sslmode=disable';
const backendExample = `# Robinhood Chain Testnet local integration. Copy to .env and replace the RPC placeholder.\nTG_ENV=development\nTG_HTTP_ADDR=127.0.0.1:8790\nTG_CHAIN_ID=46630\nTG_LOG_LEVEL=info\nTG_WEB_ORIGIN=http://127.0.0.1:5176\nTG_SHUTDOWN_TIMEOUT=10s\nTG_PROBE_TIMEOUT=2s\nTG_DB_MAX_CONNS=10\nTG_DATABASE_URL=${database}\nTG_MIGRATION_DATABASE_URL=${database}\nTG_INDEXER_DATABASE_URL=${database}\nTG_PUBLISHER_DATABASE_URL=${database}\nTG_DISCOVERY_DATABASE_URL=${database}\nTG_PROJECTION_DATABASE_URL=${database}\nTG_EVENT_DATABASE_URL=${database}\nTG_ACTIVITY_DATABASE_URL=${database}\nTG_TRANSACTION_DATABASE_URL=${database}\nTG_STATUS_DATABASE_URL=${database}\nTG_RECONCILIATION_DATABASE_URL=${database}\nTG_RPC_URL=https://robinhood-testnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>\nTG_STATUS_RPC_URL=https://robinhood-testnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>\nTG_DEPLOYMENT_MANIFEST=${manifestPath}\nTG_ANALYTICS_MANIFEST=${manifestPath}\nTG_TRANSACTION_STATUS_MANIFEST=${manifestPath}\nTG_INDEXER_START_BLOCK=${startBlock}\nTG_DISCOVERY_START_BLOCK=${startBlock}\nTG_PROJECTION_START_BLOCK=${startBlock}\nTG_EVENT_START_BLOCK=${startBlock}\nTG_ACTIVITY_START_BLOCK=${startBlock}\nTG_DISCOVERY_EMPTY_BATCH_SIZE=64\nTG_PUBLISH_IDENTITIES=true\nTG_SCOPED_OBSERVATIONS=1\nTG_STATUS_MAX_LAG_BLOCKS=100\nTG_STATUS_MAX_PROGRESS_AGE=15m\nTG_CONTENT_DATABASE_URL=${database}\nTG_CONTENT_HTTP_ADDR=127.0.0.1:8791\nTG_CONTENT_PUBLIC_ORIGIN=http://127.0.0.1:8791\nTG_CONTENT_WEB_ORIGIN=http://127.0.0.1:5176\n`;
const backendExamplePath = root + 'services/backend-go/.env.robinhood-testnet.example';
fs.writeFileSync(backendExamplePath, backendExample);
const rpc = `https://robinhood-testnet.g.alchemy.com/v2/${rootEnv.ALCHEMY_API_KEY}`;
const backendLocal = backendExample.replaceAll('https://robinhood-testnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>', rpc);
fs.writeFileSync(root + 'services/backend-go/.env', backendLocal, {mode: 0o600});
fs.chmodSync(root + 'services/backend-go/.env', 0o600);

const component = (name) => detail.ordinaryComponents[[
  'AccessManager', 'OfficialStockRegistryV1', 'ApprovedQuoteRegistry', 'TickerGardenBaselineRegistry',
  'LaunchTemplateRegistry', 'LaunchConfigResolver', 'TickerMemeTokenV1Implementation', 'TickerGardenCurveImplementation',
  'MemeStockGauge', 'LaunchAndBuyRouter', 'MarketRegistryV1', 'CreatorRevenueRegistry', 'AllocationManager',
  'UserStockVault', 'HolderRewardsDistributorV1', 'ProtocolFeeVault',
].indexOf(name)].toLowerCase();
const catalog = JSON.stringify([{
  releaseId: 'rh-testnet-' + releaseId.slice(2, 14),
  chainId: 46630,
  factory: detail.factory.toLowerCase(),
  marketRegistry: component('MarketRegistryV1'),
  hook: detail.hook.toLowerCase(),
  feeVault: component('ProtocolFeeVault'),
  creatorRegistry: component('CreatorRevenueRegistry'),
  holderDistributor: component('HolderRewardsDistributorV1'),
  launchRouter: component('LaunchAndBuyRouter'),
  allocationManager: component('AllocationManager'),
}]);
const frontendEnv = `# Robinhood Chain Testnet local integration. No secret RPC key is exposed to Vite.\nVITE_V1_CHAIN_ID=46630\nVITE_V1_READ_API_URL=http://127.0.0.1:8790\nVITE_LAUNCH_METADATA_ORIGIN=http://127.0.0.1:8791\nVITE_V1_FACTORY_ADDRESS=${detail.factory.toLowerCase()}\nVITE_V1_LAUNCH_ROUTER_ADDRESS=${component('LaunchAndBuyRouter')}\nVITE_V1_ALLOCATION_MANAGER_ADDRESS=${component('AllocationManager')}\nVITE_V1_PROTOCOL_FEE_VAULT_ADDRESS=${component('ProtocolFeeVault')}\nVITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS=${component('CreatorRevenueRegistry')}\nVITE_V1_TREASURY_DISTRIBUTOR_ADDRESS=${component('HolderRewardsDistributorV1')}\nVITE_MARKET_RELEASE_CATALOG=${catalog}\n# Enable only after the corresponding public-chain E2E approval is recorded.\n# VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL=HOLDER_STREAM_24H_V1:DEPLOYED_E2E_APPROVED\n# VITE_V1_TREASURY_PROOF_API_URL=http://127.0.0.1:8790\n# VITE_V1_TREASURY_RELEASE_APPROVAL=V1-TREASURY-EXEC-1:EMPTY_EPOCH_V1:DEPLOYED_E2E_APPROVED\n`;
fs.writeFileSync(root + 'apps/web/.env.robinhood-testnet.example', frontendEnv);
fs.writeFileSync(root + 'apps/web/.env.local', frontendEnv, {mode: 0o600});
fs.chmodSync(root + 'apps/web/.env.local', 0o600);

console.log(JSON.stringify({status: 'LOCAL_INTEGRATION_CONFIG_PREPARED', backendManifest: manifestPath, backendContracts: contracts.length, startBlock, backendEnv: root + 'services/backend-go/.env', frontendEnv: root + 'apps/web/.env.local', secretsExposedToFrontend: false}));
