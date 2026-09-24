import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [target, service] = process.argv.slice(2);
if (!['test', 'production'].includes(target) || !['web', 'read-api', 'pipeline', 'content'].includes(service)) {
  throw Error('usage: node tools/stage-vercel-source.mjs <test|production> <web|read-api|pipeline|content>');
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
// Export exactly the checked commit, never ignored local credentials or caches.
if (git('status', '--porcelain', '--untracked-files=no')) throw Error('Commit tracked source changes before staging a deployment');
execFileSync(process.execPath, ['tools/deployment-boundary.mjs', target, service, '--source-only'], { cwd: root, stdio: 'inherit' });
const commit = git('rev-parse', 'HEAD');
const branch = git('branch', '--show-current');
const parent = path.join(root, '.codex_tmp/vercel-source');
fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
const directory = fs.mkdtempSync(path.join(parent, `${service}-${commit.slice(0,8)}-`));
const archive = path.join(directory, 'source.tar');
const fd = fs.openSync(archive, 'wx', 0o600);
try { execFileSync('git', ['archive', '--format=tar', commit], { cwd: root, stdio: ['ignore', fd, 'inherit'] }); }
finally { fs.closeSync(fd); }
execFileSync('tar', ['-xf', archive, '-C', directory]);
fs.unlinkSync(archive);
fs.writeFileSync(path.join(directory, 'source-release.json'), JSON.stringify({ schemaVersion: 1, commit, branch, target, service }, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ status: 'SOURCE_EXPORTED', target, service, branch, commit, directory }));
