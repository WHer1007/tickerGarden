import { createHash } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAlchemyWebhookCreationResponse, updateAlchemyRuntimeSecrets } from '../packages/alchemy/src/index.ts';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(backendRoot, 'config/alchemy/robinhood-block-trigger.json');
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  name: string; releaseId: string; type: 'GRAPHQL'; networkEnvironmentKey: string; callbackEnvironmentKey: string; queryFile: string; querySha256: string;
};
const query = (await readFile(path.resolve(backendRoot, config.queryFile), 'utf8')).trim();
const network = process.env[config.networkEnvironmentKey];
const webhookUrl = process.env[config.callbackEnvironmentKey];
const queryDigest = `0x${createHash('sha256').update(query).digest('hex')}`;
if (queryDigest !== config.querySha256) throw new Error('Alchemy query digest does not match versioned configuration');
const apply = process.argv.includes('--apply');

if (!apply) {
  console.log(JSON.stringify({
    status: 'dry-run', action: 'create-inactive-custom-webhook', name: config.name, releaseId: config.releaseId,
    networkConfigured: Boolean(network), callbackConfigured: Boolean(webhookUrl), queryDigest,
  }));
  process.exit(0);
}

const authToken = process.env.ALCHEMY_AUTH_TOKEN;
if (!authToken || !network || !webhookUrl) throw new Error('ALCHEMY_AUTH_TOKEN, TG_ALCHEMY_NETWORK and TG_ALCHEMY_WEBHOOK_URL are required for --apply');
const profile = process.env.TG_PROFILE;
if (profile !== 'test' && profile !== 'master') throw new Error('TG_PROFILE must be test or master for --apply');
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

const response = await fetch('https://dashboard.alchemy.com/api/create-webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-alchemy-token': authToken },
  body: JSON.stringify({ network, webhook_type: config.type, webhook_url: callback.toString(), name: config.name, graphql_query: query }),
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Alchemy create webhook returned HTTP ${response.status}`);
const result = parseAlchemyWebhookCreationResponse(await response.json());
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
