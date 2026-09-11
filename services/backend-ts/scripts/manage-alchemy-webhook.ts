import { createHash } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { toEventSelector, type AbiEvent } from 'viem';
import { parseAlchemyWebhookCreationResponse, updateAlchemyRuntimeSecrets } from '../packages/alchemy/src/index.ts';
import { f72EventCatalog } from '../packages/events/src/index.ts';

const { Pool } = pg;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(backendRoot, 'config/alchemy/robinhood-event-trigger.json');
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  name: string; releaseId: string; type: 'GRAPHQL'; networkEnvironmentKey: string; callbackEnvironmentKey: string;
  queryFile: string; querySha256: string; addressVariable: string; topicVariable: string;
};
const query = (await readFile(path.resolve(backendRoot, config.queryFile), 'utf8')).trim();
const network = process.env[config.networkEnvironmentKey];
const webhookUrl = process.env[config.callbackEnvironmentKey];
const queryDigest = `0x${createHash('sha256').update(query).digest('hex')}`;
if (queryDigest !== config.querySha256) throw new Error('Alchemy query digest does not match versioned configuration');
const apply = process.argv.includes('--apply');
const syncOnly = process.argv.includes('--sync-variables');
if (apply && syncOnly) throw new Error('choose either --apply or --sync-variables');
const fixedAddresses = [...new Set(Object.values(f72EventCatalog)
  .flatMap((entry) => 'address' in entry ? [entry.address.toLowerCase()] : []))].sort();
const eventTopics = [...new Set(Object.values(f72EventCatalog).flatMap((entry) => entry.abi
  .map((item) => toEventSelector(item as AbiEvent))))].sort();

if (!apply && !syncOnly) {
  console.log(JSON.stringify({
    status: 'dry-run', action: 'create-inactive-custom-webhook', name: config.name, releaseId: config.releaseId,
    networkConfigured: Boolean(network), callbackConfigured: Boolean(webhookUrl), queryDigest,
    fixedSourceCount: fixedAddresses.length, eventTopicCount: eventTopics.length,
  }));
  process.exit(0);
}

const authToken = process.env.ALCHEMY_AUTH_TOKEN;
if (!authToken || !network || !webhookUrl) throw new Error('ALCHEMY_AUTH_TOKEN, TG_ALCHEMY_NETWORK and TG_ALCHEMY_WEBHOOK_URL are required for management');
const profile = process.env.TG_PROFILE;
if (profile !== 'test' && profile !== 'master') throw new Error('TG_PROFILE must be test or master for management');
const repositoryRoot = path.resolve(backendRoot, '../..');
const secretEnvironmentPath = path.join(repositoryRoot, `.env.${profile}.local`);
const secretEnvironmentInfo = await lstat(secretEnvironmentPath);
if (!secretEnvironmentInfo.isFile() || secretEnvironmentInfo.isSymbolicLink() || (secretEnvironmentInfo.mode & 0o077) !== 0) {
  throw new Error(`.env.${profile}.local must be a regular mode 0600 file`);
}
const currentSecretEnvironment = await readFile(secretEnvironmentPath, 'utf8');
const callback = new URL(webhookUrl);
if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash || callback.pathname !== '/v1/webhooks/alchemy') {
  throw new Error('Alchemy callback must be a credential-free HTTPS /v1/webhooks/alchemy URL');
}

const sourceAddresses = new Set(fixedAddresses);
const databaseUrl = process.env.TG_PIPELINE_DATABASE_URL;
if (databaseUrl) {
  const schema = process.env.TG_DATABASE_SCHEMA ?? 'tickergarden_serverless';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('TG_DATABASE_SCHEMA is invalid');
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
  try {
    const result = await pool.query<{ address: string }>(`SELECT address FROM ${schema}.contract_sources`);
    for (const row of result.rows) sourceAddresses.add(row.address.toLowerCase());
  } finally {
    await pool.end();
  }
}
await Promise.all([
  syncVariable(config.addressVariable, [...sourceAddresses].sort()),
  syncVariable(config.topicVariable, eventTopics),
]);
if (syncOnly) {
  console.log(JSON.stringify({ status: 'variables-synchronized', addressCount: sourceAddresses.size, eventTopicCount: eventTopics.length }));
  process.exit(0);
}

const response = await fetch('https://dashboard.alchemy.com/api/create-webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-alchemy-token': authToken },
  body: JSON.stringify({ network, webhook_type: config.type, webhook_url: callback.toString(), name: config.name, graphql_query: query }),
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Alchemy create webhook returned HTTP ${response.status}`);
let result = parseAlchemyWebhookCreationResponse(await response.json());
if (result.active) {
  const disable = await fetch('https://dashboard.alchemy.com/api/update-webhook', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-alchemy-token': authToken },
    body: JSON.stringify({ webhook_id: result.webhookId, is_active: false }), signal: AbortSignal.timeout(15_000),
  });
  if (!disable.ok) {
    await fetch(`https://dashboard.alchemy.com/api/delete-webhook?webhook_id=${encodeURIComponent(result.webhookId)}`, {
      method: 'DELETE', headers: { 'x-alchemy-token': authToken }, signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
    throw new Error(`Alchemy created an active webhook and disable returned HTTP ${disable.status}`);
  }
  result = parseAlchemyWebhookCreationResponse(await disable.json());
}
if (result.active) throw new Error('Alchemy webhook remained active after fail-closed disable');
const nextSecretEnvironment = updateAlchemyRuntimeSecrets(currentSecretEnvironment, result);
const temporaryPath = `${secretEnvironmentPath}.${process.pid}.tmp`;
let temporary;
try {
  temporary = await open(temporaryPath, 'wx', 0o600);
  await temporary.writeFile(nextSecretEnvironment, 'utf8');
  await temporary.sync();
  await temporary.close();
  temporary = undefined;
  await rename(temporaryPath, secretEnvironmentPath);
} finally {
  await temporary?.close().catch(() => undefined);
  await unlink(temporaryPath).catch(() => undefined);
}
console.log(JSON.stringify({
  status: 'created-inactive', webhookId: result.webhookId, version: result.version,
  active: result.active, queryDigest, secretsStored: true, secretEnvironment: path.basename(secretEnvironmentPath),
  next: 'Copy the stored webhook ID and signing key into the protected pipeline Preview environment, test delivery, then activate explicitly.',
}));

async function syncVariable(name: string, items: readonly string[]): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || items.length === 0) throw new Error('invalid Alchemy variable configuration');
  const response = await fetch(`https://dashboard.alchemy.com/api/graphql/variables/${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-alchemy-token': authToken! },
    body: JSON.stringify({ items }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Alchemy variable ${name} returned HTTP ${response.status}`);
}
