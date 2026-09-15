import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../../../', import.meta.url);
const output = new URL('../src/create/generated/', import.meta.url);
const paired = ['symbol','name','chainId','tokenAddress','decimals','phantomQuote','graduationThreshold','activationStatus','admissionPath','assetKind','logoUrl'];
const staking = ['symbol','name','chainId','tokenAddress','decimals','assetUid','logoUrl','minimumAllocation','enabled'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => key in value).map(key => [key,value[key]]));
const files = ['robinhood-mainnet-4663.paired-assets','robinhood-testnet-46630.paired-assets','arbitrum-sepolia-421614.paired-assets','robinhood-mainnet-4663.staking-assets'];
await mkdir(output,{recursive:true});
for (const name of files) {
  const source = JSON.parse(await readFile(new URL(`deployments/manifests/${name}.json`,root),'utf8'));
  const catalog = {...pick(source,['chainId','observedAt','supplyReferenceRaw']),assets:source.assets.map(asset => pick(asset,name.includes('paired') ? paired : staking))};
  const text = JSON.stringify(catalog) + '\n';
  const path = new URL(`${name}.json`,output);
  if (process.argv.includes('--check')) {
    if (await readFile(path,'utf8').catch(()=> '') !== text) throw new Error(`Stale browser asset catalog: ${name}`);
  } else await writeFile(path,text);
}
