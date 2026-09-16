import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = path.resolve(process.argv[2] ?? path.join(root, 'docs/reviews/evidence/production-release-2026-09-15'));
const build = path.join(evidence, 'build');
const archive = path.join(evidence, 'source-archive/contracts');
const compiler = process.env.SOLC_0_8_26 ?? path.join(homedir(), 'Library/Application Support/svm/0.8.26/solc-0.8.26');
const version=spawnSync(compiler,['--version'],{encoding:'utf8'});
if(version.status!==0||!version.stdout.includes('0.8.26+commit.8a97fa7a'))throw Error('Exact Solidity 0.8.26 compiler required');
const inputs = path.join(evidence, 'compiler-inputs');
fs.mkdirSync(inputs, {recursive: true});

const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => {
  const p = path.join(d, e.name); return e.isDirectory() ? walk(p) : e.name.endsWith('.sol') ? [p] : [];
});
const files = walk(archive);
const sources = Object.fromEntries(files.map(p => [path.relative(archive, p).replaceAll('\\', '/'), {content: fs.readFileSync(p, 'utf8')} ]));
const first = JSON.parse(fs.readFileSync(path.join(build, 'GraduationExecutor.json')));
const s = first.metadata.settings;
const settings = {optimizer: s.optimizer, evmVersion: s.evmVersion, metadata: s.metadata,
  remappings: (s.remappings ?? []).map(x => x.replace(/^\/Users\/dear\/Documents\/code\/TickerGarden\/contracts\//, '')),
  outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}};
const inputFile = path.join(inputs, 'standard-json-input.json');
const outputFile = path.join(inputs, 'standard-json-output.json');
fs.writeFileSync(inputFile, JSON.stringify({language: 'Solidity', sources, settings}));
const run = spawnSync(compiler, ['--standard-json'], {input: fs.readFileSync(inputFile), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
fs.writeFileSync(outputFile, run.stdout ?? '');
fs.writeFileSync(path.join(inputs, 'solc.stderr'), run.stderr ?? '');
if (run.error) throw run.error;
const output = JSON.parse(run.stdout);
const compilerErrors=(output.errors??[]).filter(x=>x.severity==='error');
if(run.status!==0||compilerErrors.length)throw Error('Independent Solidity compilation failed');
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
};
const abiKey = x => `${x.type ?? ''}|${x.name ?? ''}|${JSON.stringify(canonical(x.inputs ?? []))}|${JSON.stringify(canonical(x.outputs ?? []))}`;
const abiEqual = (a, b) => JSON.stringify(a.map(canonical).sort((x, y) => abiKey(x).localeCompare(abiKey(y)))) === JSON.stringify(b.map(canonical).sort((x, y) => abiKey(x).localeCompare(abiKey(y))));
const strip0x = x => x?.startsWith('0x') ? x.slice(2) : x;
const artifacts = fs.readdirSync(build).filter(x => x.endsWith('.json'));
if(artifacts.length!==23)throw Error('Expected all 23 archived release artifacts');
const rows = [], failures = [];
for (const file of artifacts) {
  const a = JSON.parse(fs.readFileSync(path.join(build, file)));
  const [source, name] = Object.entries(a.metadata.settings.compilationTarget)[0];
  const c = output.contracts?.[source]?.[name];
  const row = {file, source, name, abi: !!c && abiEqual(a.abi, c.abi), creation: !!c && strip0x(a.bytecode.object) === strip0x(c.evm.bytecode.object), deployed: !!c && strip0x(a.deployedBytecode.object) === strip0x(c.evm.deployedBytecode.object)};
  rows.push(row); if (!row.abi || !row.creation || !row.deployed) failures.push(row);
}
const report = {status: failures.length ? 'REPRODUCTION_FAILED' : 'REPRODUCTION_PASSED', compiler,compilerVersion:version.stdout.trim(),compilerBinarySha256:createHash('sha256').update(fs.readFileSync(compiler)).digest('hex'),sourceCount: files.length, artifactCount: artifacts.length, matched: rows.length, failures, artifacts: rows};
fs.writeFileSync(path.join(evidence, 'reproducible-build.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'reproducible-build.log'), `Compiler errors: ${(output.errors ?? []).filter(x => x.severity === 'error').length}\nArtifacts: ${artifacts.length}; matched: ${rows.length}; failures: ${failures.length}\nStatus: ${report.status}\n`);
console.log(`${report.status}: ${rows.length - failures.length}/${rows.length} artifacts matched`);
if(failures.length)process.exitCode=1;
