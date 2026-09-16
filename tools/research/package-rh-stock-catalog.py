#!/usr/bin/env python3
"""Keep the production reference data with docs; outputs/raw remains local research evidence."""
import gzip,hashlib,json,pathlib,shutil,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/reviews/rh-mainnet-stock-catalog-2026-09-12')
assert json.loads((OUT/'summary.json').read_text())['datasetStatus']=='COMPLETE_WITH_DOCUMENTED_COVERAGE_LIMITS'
DEST=ROOT/'docs/references/data'/OUT.name;DEST.mkdir(parents=True,exist_ok=True)
plain=['stocks.csv','release-stock-candidates.csv','summary.json','verification.json','live-sample-verification.json','data-gaps.json']
compressed=['stocks.json','pools.csv','pools.json','depth-quotes.csv']
for n in plain:shutil.copyfile(OUT/n,DEST/n)
for n in compressed:
 with (OUT/n).open('rb') as src,(DEST/(n+'.gz')).open('wb') as target:
  with gzip.GzipFile(filename='',mode='wb',fileobj=target,mtime=0,compresslevel=9) as gz:shutil.copyfileobj(src,gz)
for n in ['assets.json','http-receipts.json','logo-checks.json','prices-by-symbol.json','corporate-actions.json','dependency-code-verification.json','depth-price-basis.json','uniswap-deployments.json','token-chain-state.json','chain-snapshot.json']:
 (DEST/'source').mkdir(exist_ok=True);shutil.copyfile(OUT/'raw'/n,DEST/'source'/n)
manifest={str(p.relative_to(DEST)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(DEST.rglob('*')) if p.is_file() and p.name not in ['sha256.json','README.md']}
(DEST/'sha256.json').write_text(json.dumps(manifest,indent=2)+'\n')
(DEST/'README.md').write_text('''# RH 主链 Stock Token 数据包\n\n链上快照与覆盖限制见 summary.json、data-gaps.json 及上级目录报告。stocks.csv 与 release-stock-candidates.csv 可直接筛选；较大的完整 JSON/CSV 使用 gzip 压缩，解压后是标准 UTF-8 JSON/CSV。source/ 保存官方 HTTP 回包、链上身份和依赖校验、价格换算依据及快照区块。全部解压后 SHA256 可与本地 outputs 对应文件比较；sha256.json 校验本数据包的原始文件。\n\n数据用于生产准备参考。报价、流动性、状态会变动；不自动激活任何 Quote，不表示完成合约准入。更完整的原始事件及逐笔链上回包位于本地 outputs/reviews 同名目录，可由 tools/research 的只读脚本重新采集。\n\n例如查看完整池目录：\n\n```sh\ngzip -dc pools.csv.gz > pools.csv\n```\n''')
old='../../outputs/reviews/'+OUT.name;new='data/'+OUT.name
for p in (ROOT/'docs/references').glob('RH_MAINNET_STOCK*2026-09-12.md'):
 text=p.read_text()
 for n in plain+['sha256.json']:text=text.replace(f'({old}/{n})',f'({new}/{n})')
 for n in compressed:text=text.replace(f'({old}/{n})',f'({new}/{n}.gz)')
 text=text.replace('原始证据目录]','本地原始证据目录（outputs，不纳入 Git）]')
 p.write_text(text)
print('Packaged',len(manifest),'data files at',DEST)
