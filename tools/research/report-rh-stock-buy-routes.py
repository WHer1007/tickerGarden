"""Build human-readable evidence from the read-only pinned-block route audit."""
import json,csv,pathlib,collections,datetime
from decimal import Decimal,localcontext
ROOT=pathlib.Path(__file__).resolve().parents[2];p=ROOT/'outputs/reviews/rh-buy-routes-2026-09-16'
def read(n):return json.loads((p/n).read_text())
r=read('routes.json');exact={x['symbol']:x for x in read('exact-output.json')};states={x['pool']:x for x in read('states.json')};inventory=read('inventory.json');basis=read('bridge-reference.json');snap=read('snapshot.json');screen=read('screening.json')
assets=read('rh-assets.json')['response']['assets'];quotes=read('rh-prices.json')['response']['quotes'];prices={x['tokenSymbol']:x for x in quotes};refs={}
with localcontext() as ctx:
 ctx.prec=100
 for a in assets:
  q=prices.get(a['tokenSymbol'])
  if q:refs[a['tokenSymbol']]=(Decimal(q['bid'])+Decimal(q['ask']))/2*Decimal(a['currentMultiplier'])
ethusd=Decimal(basis['ethUsd18'])/10**18
rows=[];fixed=[]
for a in r['assets']:
 row={'symbol':a['symbol'],'address':a['address'],'base_pool_count':a['basePools'],'active_base_pool_count':a['activeBasePools'],'status':a['status'],'exact_output_100usd':exact.get(a['symbol'],{}).get('status','NOT_TESTED')}
 primary=next((x['best'] for x in a['observations'] if x['usd']==100),None);backup=next((x['backup'] for x in a['observations'] if x['usd']==100),None)
 row.update(primary_route=primary['route'] if primary else '',primary_pool=primary['pool'] if primary else '',version=primary['version'] if primary else '',backup_pool=backup['pool'] if backup else '')
 for x in a['observations']:
  b=x['best'];usd=x['usd'];row[f'{usd}_eth_input']=str(Decimal(b['ethRequired'])/10**18) if b else '';row[f'{usd}_stock_output']=b['stockReceived'] if b else '';row[f'{usd}_pool_shortfall_pct']=str(Decimal(b['shortfallBps'])/100) if b and b['shortfallBps'] is not None else '';row[f'{usd}_pool']=b['pool'] if b else ''
 row['max_tested_usd_with_pool_shortfall_lte_2pct']=max((x['usd'] for x in a['observations'] if x['best'] and x['best']['shortfallBps'] is not None and Decimal(x['best']['shortfallBps'])<=200),default=0)
 if primary and a['symbol'] in refs:
  output=Decimal(primary['stockReceived']);nominal=Decimal(primary['ethRequired'])/10**18*ethusd
  row['rh_reference_price_usd']=str(refs[a['symbol']]);row['rh_reference_generated_at']=prices[a['symbol']]['generatedAt'];row['100_pool_cost_vs_later_rh_mid_pct']=str((nominal/output/refs[a['symbol']]-1)*100) if output>0 and refs[a['symbol']]>0 else ''
 else:row['rh_reference_price_usd']='';row['rh_reference_generated_at']='';row['100_pool_cost_vs_later_rh_mid_pct']=''
 rows.append(row)
 def route(q):
  if not q:return None
  s=states[q['pool']];return {'version':q['version'],'pool':q['pool'],'input':q['input'],'output':q['output'],'fee':s['fee'],'tickSpacing':s.get('tickSpacing'),'hooks':s.get('hooks'),'bridgePool':q['bridgePool'],'wrapRequired':q['wrapRequired'],'route':q['route']}
 fixed.append({'symbol':a['symbol'],'stock':a['address'],'primary':route(primary),'backup':route(backup),'exactOutputProbe':exact.get(a['symbol']),'runtimeEnabled':False})
with (p/'stock-buy-depth.csv').open('w',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
(p/'fixed-route-candidates.json').write_text(json.dumps({'chainId':4663,'block':r['block'],'blockHash':r['blockHash'],'status':'READ_ONLY_CANDIDATES_NOT_EXECUTION_ACCEPTED','assets':fixed},indent=2))
found=[x for x in rows if x['primary_pool']];missing=[x['symbol'] for x in rows if not x['primary_pool']];quality=[x for x in rows if x['max_tested_usd_with_pool_shortfall_lte_2pct']>=1000]
counts={usd:sum(x[f'{usd}_stock_output']!='' for x in rows) for usd in r['levelsUsd']}
preferred=collections.Counter(x['version'] for x in found);paths=collections.Counter('via USDG' if 'USDG →' in x['primary_route'] else 'direct ETH/WETH' for x in found)
timestamp=datetime.datetime.fromtimestamp(int(snap['timestamp']),datetime.timezone.utc).isoformat()
lines=['# 194 个 Stock 主网购买路线核验','',f'固定区块：{r["block"]}；区块时间：{timestamp}；哈希：`{r["blockHash"]}`。','',f'194 个官方地址均匹配。发现池的资产 {sum(x["poolCount"]>0 for x in inventory)}/194。ETH/WETH/USDG 候选池 {len(states)}；小额买入报价筛选 {len(screen)} 个候选池。',f'约 $100 档存在不带自定义 Hook 的购买报价：{len(found)}/194；相应 Stock 单池 exact-output 验证成功：{sum(x["status"]=="QUOTED" for x in exact.values())}。',f'首选池版本：{dict(preferred)}；路线：{dict(paths)}。',f'约 $1,000 或更高档、Stock 购买腿平均成交相对池内即时报价偏离（含池费）不超过 2% 的资产：{len(quality)}。该数值是研究分组，不是交易滑点设置。','', '## 分档报价覆盖','', '| 约投入 USD | 有正数输出 | 池内偏离含费 ≤2% | ≤5% |','|---:|---:|---:|---:|']
lines += [f'| {usd:,} | {counts[usd]}/194 | {sum(bool(x[f"{usd}_pool_shortfall_pct"]) and Decimal(x[f"{usd}_pool_shortfall_pct"])<=2 for x in rows)} | {sum(bool(x[f"{usd}_pool_shortfall_pct"]) and Decimal(x[f"{usd}_pool_shortfall_pct"])<=5 for x in rows)} |' for usd in r['levelsUsd']]
lines += ['', '## 固定路线建议','', '优先使用下表 $100 档首选池与备用池；它们只是快照候选，不应直接永久硬编码。实际发行仍需重新报价、检查用户确认的 ETH 支出上限、核验池及交易结果。WETH 与 ETH 按 1:1 包装，表中 ETH 输入不含包装、兑换、授权和发行 Gas。', '需要 USDG 的路线先以 exact-output 买到所需 USDG，再报价 Stock 购买腿。当前验证是各腿独立 eth_call，尚不是整条 Universal Router 路线的执行模拟。', '', '## 样本','', '| Stock | 首选路线 | 版本 | $100 档 ETH 输入 | Stock 到账 | 池内偏离含费 |','|---|---|---|---:|---:|---:|']
for symbol in ['NVDA','TSLA','AAPL','MSFT','AMZN','GOOGL','META','SPY','QQQ','AVGO','GLD']:
 x=next((x for x in rows if x['symbol']==symbol),None)
 if x:lines.append(f'| {symbol} | {x["primary_route"] or "无简单路线报价"} | {x["version"] or "-"} | {x["100_eth_input"] or "-"} | {x["100_stock_output"] or "-"} | {x["100_pool_shortfall_pct"]+"%" if x["100_pool_shortfall_pct"] else "-"} |')
lines += ['', '## 本范围未找到简单路线报价的资产','', ', '.join(missing) or '无', '', '已对 SATS/BND 的零活跃流动性池追加 18 次 $10/$100/$1,000 报价，均未取得正数输出，见 zero-liquidity-probes.json。其他资产的零活跃流动性无 Hook 池没有穷举报价。', '', '这不表示 Stock 被判定无效，也不表示全网没有流动性；可能存在自定义 Hook、其他 DEX、其他中转币或未纳入的交易机制。', '', '## 方法与边界','', '- 扫描官方 Uniswap V2/V3/V4 工厂／PoolManager 的 Stock 池；复核 9 月 12 日旧快照区块哈希后补扫至本次固定区块。并非所有 DEX 的全网池枚举。', '- V2 池仅做发现和状态／身份核验，本次固定路线选择限定 V3/V4。', '- V3 及 V2 的 token0/token1/factory 与 V3 fee 已逐池核验；V4 PoolKey 哈希与 poolId 匹配；所有报价用同一个区块。', '- ETH/WETH/USDG 为候选中转资产。Stock/Stock、Stock/Meme 只保留发现记录，不用于此次简单购买路线。', '- 先对候选池测试约 $100 输入，再对每个资产直接路线与 USDG 路线各最多 3 个池测试 $10/$100/$1,000/$5,000/$10,000。未遍历大额下每个池的全局最优路径。', '- 自定义 Hook 池使用空 hookData 探测，并单独计数；未审查 Hook 的执行权限、费用和回调，因此不选作固定候选。', '- USDG 固定按 1 USD；ETH 的美元量级取链上 ETH/USDG 小额可执行报价，仅用于金额分档。没有给 USDG 接入额外美元报价源。', '- 池内偏离包含池费和价格影响，不等于单纯滑点；存在正数输出也不代表经济上合适。完整 CSV 另含后取得的 RH 参考价对比，该参考价与链上快照并非同一时间，不作为成交保证。', '- 最大通过档位只是最大“已测试档位”，不是池的绝对容量。Gas 未加入路线成本排序。', '- 没有签名、没有发送交易、没有修改合约或生产配置。投产前仍需对选定路线做主网 Fork 的完整兑换与余额校验。', '', '## 文件','', '- `stock-buy-depth.csv`：194 个 Stock 的分档结果、主备池、参考价格差。', '- `fixed-route-candidates.json`：主备路线候选；runtimeEnabled 均为 false。', '- `inventory.json`：全部 Stock 的池计数及配对地址。', '- `states.json`、`screening.json`、`depth.json`、`bridge-depth.json`、`exact-output.json`：原始状态与链上报价证据。', '', '官方合约地址来源：https://developers.uniswap.org/deployments', '官方 Stock 目录及价格：https://docs.robinhood.com/chain/stock-token-apis/']
(p/'REPORT.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'assets':len(rows),'routes':len(found),'exactOutput':sum(x['status']=='QUOTED' for x in exact.values()),'counts':counts,'quality1000':len(quality),'versions':dict(preferred),'paths':dict(paths),'missing':missing},ensure_ascii=False))
