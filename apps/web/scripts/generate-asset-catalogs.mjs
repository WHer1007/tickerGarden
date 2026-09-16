import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../../../', import.meta.url);
const output = new URL('../src/create/generated/', import.meta.url);
const paired = ['symbol','name','chainId','tokenAddress','decimals','phantomQuote','graduationThreshold','activationStatus','admissionPath','assetKind','logoUrl'];
const staking = ['symbol','name','chainId','tokenAddress','decimals','assetUid','logoUrl','minimumAllocation','enabled'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => key in value).map(key => [key,value[key]]));
const files = ['robinhood-mainnet-4663.paired-assets','robinhood-testnet-46630.paired-assets','arbitrum-sepolia-421614.paired-assets','robinhood-mainnet-4663.staking-assets'];
await mkdir(output,{recursive:true});
const mainnet = JSON.parse(await readFile(new URL('deployments/manifests/robinhood-mainnet-4663.paired-assets.json',root),'utf8'));
const bundledLogos = new Map();
for (const asset of mainnet.assets.filter(asset => asset.logoUrl)) {
  const filename = `${asset.tokenAddress.toLowerCase()}.png`;
  const image = await readFile(new URL(`../public/stock-logos/${filename}`,import.meta.url));
  if (!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`Invalid Stock logo: ${asset.symbol}`);
  bundledLogos.set(filename,true);
}
for (const name of files) {
  const source = JSON.parse(await readFile(new URL(`deployments/manifests/${name}.json`,root),'utf8'));
  const catalog = {...pick(source,['chainId','observedAt','supplyReferenceRaw']),assets:source.assets.map(asset => {
    const row = pick(asset,name.includes('paired') ? paired : staking);
    if (source.chainId === 4663 && asset.logoUrl) {
      const filename = `${asset.tokenAddress.toLowerCase()}.png`;
      const image = bundledLogos.get(filename);
      if (!image) throw new Error(`Missing bundled Stock logo: ${asset.symbol}`);
      row.logoUrl = `/stock-logos/${filename}`;
    }
    return row;
  })};
  const text = JSON.stringify(catalog) + '\n';
  const path = new URL(`${name}.json`,output);
  if (process.argv.includes('--check')) {
    if (await readFile(path,'utf8').catch(()=> '') !== text) throw new Error(`Stale browser asset catalog: ${name}`);
  } else await writeFile(path,text);
}
