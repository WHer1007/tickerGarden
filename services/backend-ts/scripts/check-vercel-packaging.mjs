import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendRoot, '../..');
const expectedApps = ['read-api', 'pipeline', 'content'];
const failures = [];
const environmentExamples = ['config/test.env.example', 'config/master.env.example'].map((path) => {
  const source = readFileSync(join(repositoryRoot, path), 'utf8');
  return { path, singleRpc: /^TG_RPC_VERIFICATION_MODE=['"]?single['"]?$/m.test(source), keys: new Set(source.split(/\r?\n/).map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]).filter(Boolean)) };
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message) {
  failures.push(message);
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

const rootPackage = readJson(join(backendRoot, 'package.json'));
const lockfile = readJson(join(backendRoot, 'package-lock.json'));

if (rootPackage.engines?.node !== '24.x') {
  fail('root package.json must pin engines.node to 24.x');
}
if (lockfile.lockfileVersion !== 3) fail('package-lock.json must use lockfileVersion 3');
if (JSON.stringify(lockfile.packages?.['']?.workspaces) !== JSON.stringify(rootPackage.workspaces)) {
  fail('root workspace declarations differ between package.json and package-lock.json');
}

const workspaceDirectories = [
  ...readdirSync(join(backendRoot, 'apps')).map((name) => join(backendRoot, 'apps', name)),
  ...readdirSync(join(backendRoot, 'packages')).map((name) => join(backendRoot, 'packages', name)),
].filter((path) => statSync(path).isDirectory());

const workspaces = new Map();
for (const directory of workspaceDirectories) {
  const manifestPath = join(directory, 'package.json');
  const manifest = readJson(manifestPath);
  if (!manifest.name) fail(`${relative(backendRoot, manifestPath)} has no package name`);
  else if (workspaces.has(manifest.name)) fail(`duplicate workspace package name ${manifest.name}`);
  else workspaces.set(manifest.name, { directory, manifest, manifestPath });

  const lockKey = relative(backendRoot, directory).split(sep).join('/');
  if (lockfile.packages?.[lockKey]?.name !== manifest.name) {
    fail(`${lockKey} is missing or stale in package-lock.json`);
  }
}

for (const { directory, manifest } of workspaces.values()) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const sourceFiles = walk(directory).filter((path) => /\.(?:mjs|ts)$/.test(path));
  for (const sourceFile of sourceFiles) {
    const source = readFileSync(sourceFile, 'utf8');
    const syntax = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, false);
    const specifiers = [];
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        specifiers.push(node.moduleSpecifier.text);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specifiers.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    for (const specifier of specifiers) {
      if (!specifier || specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      const dependency = packageName(specifier);
      if (!declared.has(dependency)) {
        fail(`${relative(backendRoot, sourceFile)} imports undeclared dependency ${dependency}`);
      }
    }
  }
}

for (const appName of expectedApps) {
  const appDirectory = join(backendRoot, 'apps', appName);
  const manifestPath = join(appDirectory, 'package.json');
  const manifest = readJson(manifestPath);
  if (manifest.engines?.node !== '24.x') {
    fail(`apps/${appName}/package.json must pin engines.node to 24.x`);
  }

  const appSource = readFileSync(join(appDirectory, 'src/index.ts'), 'utf8');
  const requiredBlock = appSource.match(/requiredEnvironmentKeys:\s*\[([\s\S]*?)\]/)?.[1];
  if (!requiredBlock) fail(`apps/${appName}/src/index.ts has no literal requiredEnvironmentKeys contract`);
  const requiredKeys = [...(requiredBlock ?? '').matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((match) => match[1]);
  for (const example of environmentExamples) {
    if (appName === 'pipeline' && !example.singleRpc && !example.keys.has('TG_SECONDARY_RPC_URL')) fail(`${example.path} requires a secondary RPC in dual mode`);
    if (example.singleRpc && (example.keys.has('TG_SECONDARY_RPC_URL') || example.keys.has('TG_LOGS_SECONDARY_RPC_URL'))) fail(`${example.path} must not mix single mode and secondary endpoints`);
  }
  for (const key of requiredKeys) {
    if (key === 'ALCHEMY_AUTH_TOKEN' || key.startsWith('VITE_')) fail(`apps/${appName} must not require management or public environment key ${key}`);
    for (const example of environmentExamples) {
      if (!example.keys.has(key)) fail(`${example.path} is missing ${appName} runtime key ${key}`);
    }
  }

  const config = readJson(join(appDirectory, 'vercel.json'));
  for (const [name, fn] of Object.entries(config.functions ?? {})) {
    if(fn.includeFiles !== '../../../../source-release.json') fail(`apps/${appName}/${name} must package source provenance`);
  }
  if (config.installCommand !== 'npm ci --prefix ../.. --workspaces --include-workspace-root --include=dev --ignore-scripts') {
    fail(`apps/${appName}/vercel.json must install the locked backend workspace before compiling shared packages`);
  }
  if(appName==='read-api'&&(config.functions?.['api/events.ts']?.maxDuration!==300||config.rewrites?.[0]?.destination!=='/api/events'))fail('read-api must isolate the bounded SSE stream from ordinary 20-second queries');
  const expectedMaxDuration = appName === 'pipeline' ? 300 : 20;
  if (config.functions?.['api/index.ts']?.maxDuration !== expectedMaxDuration) {
    fail(`apps/${appName}/vercel.json must configure api/index.ts maxDuration=${expectedMaxDuration}`);
  }
  if (!config.rewrites?.some((rule) => rule.source === '/(.*)' && rule.destination === '/api')) {
    fail(`apps/${appName}/vercel.json must route requests to /api`);
  }

  const entrypoint = join(appDirectory, 'api/index.ts');
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      `const module = await import(${JSON.stringify(pathToFileURL(entrypoint).href)}); if (typeof module.default?.fetch !== 'function') throw new Error('default export must expose fetch(request)');`,
    ],
    { cwd: appDirectory, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } },
  );
  if (probe.status !== 0) {
    fail(`apps/${appName}/api/index.ts failed the Node entrypoint probe: ${probe.stderr.trim()}`);
  }
}

const relativeBackendRoot = relative(repositoryRoot, backendRoot).split(sep).join('/');
if (relativeBackendRoot !== 'services/backend-ts') {
  fail(`unexpected backend workspace path ${relativeBackendRoot}`);
}

if (failures.length > 0) {
  for (const message of failures) process.stderr.write(`- ${message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Vercel packaging preflight passed for ${expectedApps.length} apps, ${workspaces.size} workspaces and ${environmentExamples.length} environment templates on ${process.version}.\n`,
  );
}
