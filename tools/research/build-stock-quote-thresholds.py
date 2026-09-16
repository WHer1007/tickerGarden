"""Reproduce the approved $7,000 Stock Quote threshold snapshot without network access."""
import json,sys,hashlib
from pathlib import Path
from decimal import Decimal as D, getcontext, ROUND_HALF_UP
getcontext().prec=90
ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'docs/references/data/rh-stock-quote-thresholds-2026-09-12'
REPORT=ROOT/'docs/references/RH_STOCK_QUOTE_THRESHOLDS_2026-09-12.md'

def build():
    release=json.loads((ROOT/'deployments/manifests/robinhood-mainnet-4663.paired-assets.json').read_text())
    assets=json.loads((DATA/'assets.json').read_text())['response']['assets']
    responses=json.loads((DATA/'prices.json').read_text())
    rows=[]
    # Historical 53-asset snapshot keeps its captured order after production catalog expansion.
    historical=[next(a for a in release['assets'] if a['symbol']==r['symbol']) for r in responses]
    for pair in historical:
        if pair['assetKind']!='OFFICIAL_STOCK': continue
        address=pair['tokenAddress'].lower()
        matching=[a for a in assets if any(d['chainId']==4663 and d['contractAddress'].lower()==address for d in a['deployments'])]
        assert len(matching)==1
        a=matching[0]
        assert a['id']==pair['assetUid'] and a['tokenSymbol']==pair['symbol'] and a['tokenDecimals']==pair['decimals'] and a['status']=='ASSET_STATUS_ACTIVE'
        quotes=[(r,q) for r in responses for q in r['response']['quotes'] if q['tokenSymbol']==pair['symbol'] and any(d['chainId']==4663 and d['contractAddress'].lower()==address for d in q['deployments'])]
        assert len(quotes)==1
        response,q=quotes[0]
        bid,ask,mult=map(D,[q['bid'],q['ask'],a['currentMultiplier']])
        assert q['currency']=='USD' and 0<bid<=ask and mult>0
        price=(bid+ask)/2*mult
        threshold=(D(7000)/price).quantize(D('.01'),rounding=ROUND_HALF_UP)
        assert threshold>0
        phantom=threshold*D('.4')
        unit=D(10)**pair['decimals']
        assert threshold*unit==(threshold*unit).to_integral_value() and phantom*unit==(phantom*unit).to_integral_value()
        spread=(ask-bid)/((ask+bid)/2)*100
        rows.append(dict(symbol=pair['symbol'],tokenAddress=address,assetUid=a['id'],decimals=pair['decimals'],bid=q['bid'],ask=q['ask'],multiplier=a['currentMultiplier'],referencePriceUsd=str(price),generatedAt=q['generatedAt'],receivedAt=response['receivedAt'],source=response['url'],isTradingHalt=q.get('isTradingHalt'),pendingMultiplier=a.get('pendingMultiplier'),spreadPct=str(spread),graduationThresholdTokens=f'{threshold:.2f}',phantomQuoteTokens=format(phantom.normalize(),'f'),graduationThreshold=str(int(threshold*unit)),phantomQuote=str(int(phantom*unit)),roundedValueUsd=str(threshold*price),roundingErrorUsd=str(threshold*price-7000)))
    assert len(rows)==53 and len({r['tokenAddress'] for r in rows})==53
    result=dict(chainId=4663,targetUsd='7000',priceMethod='RH_UNDERLYING_BID_ASK_MID_TIMES_MULTIPLIER_ONCE',thresholdRounding='ROUND_HALF_UP_2_DECIMALS',phantomQuoteRatioBps=4000,sources=[dict(path=str((DATA/n).relative_to(ROOT)),sha256=hashlib.sha256((DATA/n).read_bytes()).hexdigest()) for n in ['assets.json','prices.json']],assets=rows)
    lines=['# Stock Quote：7,000 USD 等价毕业阈值','', '2026-09-12 用户批准按当前参考价计算项目已选 **53 个 Stock Quote**，毕业阈值四舍五入保留两位小数。此表不扩展到未选中的全部官方资产，不改变 ETH 的 3 / 1.2 或 USDG 的 7,000 / 2,800 参数；cbBTC 仍待定。','', '## 计算口径','', '- Token USD 参考价 = 官方标的 (bid + ask) / 2 × currentMultiplier，乘数只应用一次。价格不提前截断。','- 毕业阈值 = ROUND_HALF_UP(7000 / Token 参考价, 2)。USD 等值因两位小数舍入略有偏差；不是只向上取整。','- 虚拟储备 = 已舍入毕业阈值 × 40%，精确保存，必要时有四位小数，不能再次舍入至两位而破坏 40% 比例。','- 全程 Decimal / 原始整数计算。快照中间价不是可执行交易报价，generatedAt 是服务生成时间，不代表标的最后成交时间；周末及休市价差可能很宽。表中价差超过 10% 标记“宽价差”，该标记仅提示参考质量，不把阈值解释为可保证的 USD 价值。','- 参数作为本次批准的固定 Token 数量写入生产候选，不随以后价格自动更新。上线还需资产审核、Fork 验证和 Registry 激活；后续修改需新配置 ID，已有市场不受影响。','',f"采集范围（UTC）：{min(r['receivedAt'] for r in rows)} — {max(r['receivedAt'] for r in rows)}。",'', '| Stock | Token 参考价 USD | 毕业阈值（Token） | 虚拟储备（Token） | 舍入后参考 USD | 价差提示 |','|---|---:|---:|---:|---:|---|']
    for r in rows:
        lines.append(f"| {r['symbol']} | {D(r['referencePriceUsd']):.6f} | {r['graduationThresholdTokens']} | {r['phantomQuoteTokens']} | {D(r['roundedValueUsd']):.2f} | {'宽价差 ' if D(r['spreadPct'])>10 else ''}{D(r['spreadPct']):.2f}% |")
    lines+=['','完整原始价格、乘数、地址、时间和 raw 数量见 [计算 JSON](./data/rh-stock-quote-thresholds-2026-09-12/thresholds.json)。来源：[官方价格 API 口径](https://docs.robinhood.com/chain/stock-token-apis/)、[官方资产目录](https://api.robinhood.com/rhj/assets)。','', '复现：`python3 tools/research/build-stock-quote-thresholds.py --check`，随后 `python3 tools/generate-v1-paired-assets.py --check`。两者均不请求网络。','']
    return result,'\n'.join(lines)

if __name__=='__main__':
    result,report=build()
    for path,content in [(DATA/'thresholds.json',json.dumps(result,indent=2)+'\n'),(REPORT,report)]:
        if '--check' in sys.argv:
            assert path.exists() and path.read_text()==content,f'Drift: {path}'
        else:path.write_text(content)
    print('Verified 53 Stock thresholds, two-decimal rounding and exact 40% reserves')
