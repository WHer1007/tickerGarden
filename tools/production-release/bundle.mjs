import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {read,write,sha,json,equal} from './common.mjs';
import {checkCandidate} from './check.mjs';

const output=path.resolve(process.argv[2]??'docs/reviews/evidence/production-release-2026-09-15');
const checked=checkCandidate(output);write(path.join(output,'candidate-check.json'),checked);
const challenges=read(path.join(output,'control-challenges.json'));
equal(challenges.releaseId,checked.releaseId,'control challenge release');equal(challenges.packSha256,sha(path.join(output,'transactions.unsigned.json')),'control challenge transaction pack');
const roots=[
 'activation-plan.json','candidate-check.json','control-challenges.json','fee-budget.json','input-lock.json',
 'mainnet-snapshot.json','native-fee-quotes.json','reproducible-build.json','runtime-build-provenance.json',
 'runtime-catalog.candidate.json','runtime-code.json','runtime-export.json','runtime-plan.json','runtime-sizes.json',
 'simulation-receipts.jsonl','simulation-summary.json','release-drills.json','transactions.unsigned.json','source-sha256.json',
 'candidate-fork.log','contract-tests.log','registry-tests.log','spec-gates.log','spec-prose-alignment.log',
 'deployment-tests.log','release-tests.log','cross-layer-gates.log','tooling-safety-tests.log','reproducible-build.log',
 'build','compiler-inputs','source-archive',
];
const files=[];
const walk=relative=>{
 const absolute=path.join(output,relative),stat=fs.lstatSync(absolute);
 if(stat.isDirectory()){for(const entry of fs.readdirSync(absolute).sort())walk(path.join(relative,entry));}
 else if(stat.isFile())files.push(relative);else throw Error('Archive accepts regular files only: '+relative);
};
for(const root of roots)walk(root);
const hashes=Object.fromEntries(files.sort().map(file=>[file,sha(path.join(output,file))]));
write(path.join(output,'SHA256SUMS.json'),{status:'UNSIGNED_CANDIDATE_EVIDENCE',releaseId:checked.releaseId,files:hashes});
const name='tickergarden-4663-'+checked.releaseId.slice(2,14)+'-candidate.tar.gz';
execFileSync('tar',['-czf',path.join(output,name),'-C',output,'SHA256SUMS.json',...roots]);
const result={status:'TECHNICAL_CANDIDATE_ARCHIVED_NOT_BROADCAST',releaseId:checked.releaseId,file:name,sha256:sha(path.join(output,name)),bytes:fs.statSync(path.join(output,name)).size,files:files.length+1,checksumManifest:'SHA256SUMS.json',broadcastAuthorized:false,productionReady:false};
write(path.join(output,'BUNDLE.json'),result);console.log(json(result));
