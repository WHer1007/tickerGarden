import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Gate the actual deployment, not the build location or project sandbox setting.
export function assertSingaporeFunctions(inspection) {
  const clean = inspection.replace(/\u001b\[[0-9;]*m/g, '');
  if (!/status\s+●?\s*Ready\b/i.test(clean)) throw new Error('Deployment is not Ready');
  const functions = clean.split('\n').filter(line => line.includes('λ'));
  if (!functions.length) throw new Error('No runtime function region evidence in deployment inspection');
  for (const line of functions) {
    const regions = [...line.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
    if (regions.length !== 1 || regions[0] !== 'sin1') throw new Error(`Non-Singapore or unknown runtime region: ${line.trim()}`);
  }
  return functions.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [deployment, scope = 'garden24'] = process.argv.slice(2);
  if (!deployment || deployment.startsWith('-')) throw new Error('Usage: node scripts/check-vercel-region.mjs <deployment-url-or-id> [scope]');
  const cli = process.env.TG_VERCEL_CLI;
  const result = spawnSync(cli || 'npx', [...(cli ? [] : ['--no-install', 'vercel']), 'inspect', deployment, '--scope', scope], { encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Vercel inspect failed; do not promote or alias this deployment');
  const count = assertSingaporeFunctions(`${result.stdout}\n${result.stderr}`);
  console.log(`Verified ${count} function(s) in sin1: ${deployment}`);
}
