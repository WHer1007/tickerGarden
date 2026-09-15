import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { environmentPolicy, vercelProjects } from '../config/environment-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const services = new Set(Object.keys(vercelProjects));
const localReference = /(?:localhost|127\.0\.0\.1|\[::1\]|\/integration\/|\.codex_tmp\/|\/Users\/|\/tmp\/)/i;
const ownedKey = /^(?:VITE_|TG_|V1_|RH46630_|ALCHEMY_|QSTASH_|PINATA_|CRON_SECRET$)/;

function required(env, key) {
  const value = env[key];
  if (!value) throw Error(`Missing deployment variable: ${key}`);
  return value;
}

function remoteUrl(env, key, protocols = ['https:']) {
  const value = required(env, key);
  let url;
  try { url = new URL(value); } catch { throw Error(`Invalid deployment URL: ${key}`); }
  if (!protocols.includes(url.protocol) || localReference.test(value)) throw Error(`Deployment variable must use a remote ${protocols.join('/')} endpoint: ${key}`);
}

function assertServiceIsolation(service, env) {
  const keys = Object.keys(env).filter(key => ownedKey.test(key));
  const forbidden = service === 'web'
    ? keys.filter(key => !key.startsWith('VITE_') && !['TG_PROFILE', 'TG_WEB_RPC_URL', 'TG_SOURCE_BRANCH'].includes(key))
    : service === 'read-api'
      ? keys.filter(key => key.startsWith('VITE_') || /^(?:TG_PIPELINE_|TG_CONTENT_|TG_CHAIN_JOB_|TG_RPC_|TG_SECONDARY_RPC_URL$|QSTASH_|PINATA_|CRON_SECRET$)/.test(key))
      : service === 'pipeline'
        ? keys.filter(key => key.startsWith('VITE_') || /^(?:TG_CONTENT_|PINATA_)/.test(key))
        : keys.filter(key => key.startsWith('VITE_') || /^(?:TG_PIPELINE_|TG_CHAIN_JOB_|TG_RPC_|TG_SECONDARY_RPC_URL$|QSTASH_CHAIN_TOKEN$)/.test(key));
  if (forbidden.length) throw Error(`${service} contains variables owned by another service: ${forbidden.sort().join(', ')}`);
}

export function assertDeploymentBoundary(target, service, env, branch) {
  if (!['test', 'production'].includes(target)) throw Error('Deployment target must be test or production');
  if (!services.has(service)) throw Error('Unknown deployment service');
  const policy = environmentPolicy[target];
  assertDeploymentSource(target, branch);
  if (env.TG_SOURCE_BRANCH && env.TG_SOURCE_BRANCH !== branch) throw Error('CLI source branch disagrees with deployment branch');
  if (env.VERCEL_ENV && env.VERCEL_ENV !== policy.vercelEnvironment) throw Error(`${target} deployment requires Vercel ${policy.vercelEnvironment}`);
  if (env.VERCEL_TARGET_ENV && env.VERCEL_TARGET_ENV !== policy.vercelEnvironment) throw Error(`${target} deployment has the wrong Vercel target`);
  if (env.VITE_INTEGRATION_BOOTSTRAP) throw Error('Deployed environments cannot use the local integration bootstrap');
  for (const [key, value] of Object.entries(env)) if (ownedKey.test(key) && value && localReference.test(value)) throw Error(`Deployment variable contains a local reference: ${key}`);
  assertServiceIsolation(service, env);

  if (service === 'web') {
    if (required(env, 'TG_PROFILE') !== policy.profile) throw Error('Web profile does not match deployment target');
    if (required(env, 'VITE_V1_CHAIN_ID') !== policy.chainId) throw Error('Web chain does not match deployment target');
    for (const key of ['VITE_V1_READ_API_URL', 'VITE_LAUNCH_METADATA_ORIGIN', 'VITE_V1_RPC_URL']) remoteUrl(env, key);
  } else {
    if (required(env, 'TG_ENVIRONMENT') !== policy.profile) throw Error(`${service} environment does not match deployment target`);
    if (env.TG_CHAIN_ID && env.TG_CHAIN_ID !== policy.chainId) throw Error(`${service} chain does not match deployment target`);
    remoteUrl(env, service === 'read-api' ? 'TG_READ_DATABASE_URL' : service === 'pipeline' ? 'TG_PIPELINE_DATABASE_URL' : 'TG_CONTENT_DATABASE_URL', ['postgres:', 'postgresql:']);
    if (service === 'pipeline') remoteUrl(env, 'TG_RPC_URL');
    if (env.TG_ALLOWED_ORIGINS) for (const origin of env.TG_ALLOWED_ORIGINS.split(',').filter(Boolean)) {
      let url;try { url = new URL(origin); } catch { throw Error('Invalid TG_ALLOWED_ORIGINS'); }
      if (url.protocol !== 'https:' || localReference.test(origin)) throw Error('Deployed allowed origins must use remote HTTPS origins');
    }
  }
  return Object.freeze({ target, service, branch, chainId: policy.chainId, vercelEnvironment: policy.vercelEnvironment, project: vercelProjects[service] });
}

export function assertDeploymentSource(target, branch) {
  if (!['test', 'production'].includes(target)) throw Error('Deployment target must be test or production');
  const policy = environmentPolicy[target];
  if (branch !== policy.branch) throw Error(`${target} deployment requires branch ${policy.branch}; current branch is ${branch || 'detached HEAD'}`);
  return Object.freeze({ target, branch, chainId: policy.chainId, vercelEnvironment: policy.vercelEnvironment });
}

function gitBranch() { return execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(); }
function deploymentBranch() { return process.env.VERCEL_GIT_COMMIT_REF || process.env.TG_SOURCE_BRANCH || gitBranch(); }

function assertProductionPromotion() {
  const result = spawnSync('git', ['diff', '--quiet', 'test', 'HEAD', '--', 'apps', 'contracts', 'services', 'spec', 'tools', 'package.json'], { cwd: root });
  if (result.status !== 0) throw Error('Production product source differs from the tested test branch');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [requestedTarget, service, option] = process.argv.slice(2);
    const sourceOnly = option === '--source-only';
    const target = requestedTarget === 'auto' ? (process.env.VERCEL_ENV === 'production' ? 'production' : process.env.VERCEL_ENV === 'preview' ? 'test' : '') : requestedTarget;
    const result = sourceOnly ? assertDeploymentSource(target, gitBranch()) : assertDeploymentBoundary(target, service, process.env, deploymentBranch());
    if (target === 'production' && sourceOnly) assertProductionPromotion();
    if (sourceOnly && service === 'web') {
      const abi = spawnSync(process.execPath, ['apps/web/scripts/generate-v1-abis.mjs', '--check'], { cwd: root, stdio: 'inherit' });
      if (abi.status !== 0) throw Error('Web ABI inputs must match compiled artifacts before source upload');
    }
    console.log(JSON.stringify({ status: sourceOnly ? 'DEPLOYMENT_SOURCE_OK' : 'DEPLOYMENT_BOUNDARY_OK', ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment boundary check failed');
    process.exitCode = 1;
  }
}
