"""Generate the approved RH production Quote and Stake catalogs; no network or activation."""
import hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'docs/references/data/rh-all-stock-quote-thresholds-2026-09-12'
STOCK_THRESHOLDS=DATA/'thresholds.json'
LIVE=ROOT/'docs/reviews/evidence/rh-stock-vault-2026-09-12/live-identities.json'
USDG=ROOT/'docs/reviews/evidence/usdg-quote-2026-09-12/identity.json'
OUT=ROOT/'deployments/manifests/robinhood-mainnet-4663.paired-assets.json'
STAKE_OUT=ROOT/'deployments/manifests/robinhood-mainnet-4663.staking-assets.json'

def generate():
    official=json.loads((DATA/'assets.json').read_text())
    calculated=json.loads(STOCK_THRESHOLDS.read_text())
    live=json.loads(LIVE.read_text());usdg=json.loads(USDG.read_text())
    assert calculated['targetUsd']=='7000' and calculated['phantomQuoteRatioBps']==4000
    for source in calculated['sources']:
        assert hashlib.sha256((ROOT/source['path']).read_bytes()).hexdigest()==source['sha256']
    thresholds={r['tokenAddress']:r for r in calculated['assets']}
    identities={r['address'].lower():r for r in live['tokens']}
    dependencies={r['beacon'].lower():r for r in live['dependencies']}
    stocks=[a for a in official['response']['assets'] if any(d['chainId']==4663 for d in a['deployments'])]
    assert len(stocks)==len(thresholds)==194
    assets=[];staking=[]
    for symbol,address,decimals,threshold,phantom in [('ETH','0x'+'0'*40,18,'3000000000000000000','1200000000000000000'),('USDG',usdg['address'].lower(),6,'7000000000','2800000000')]:
        assert symbol!='USDG' or usdg['decimals']==6
        assets.append(dict(symbol=symbol,name='Ether' if symbol=='ETH' else 'Global Dollar',chainId=4663,tokenAddress=address,decimals=decimals,assetKind='NATIVE' if symbol=='ETH' else 'ERC20',assetUid=None,officialStatus=None,currentMultiplier=None,pendingMultiplier=None,phantomQuote=phantom,graduationThreshold=threshold,graduationThresholdStatus='APPROVED',includedInRelease=True,activationStatus='REGISTRY_ACTIVATION_REQUIRED',runtimeCodeHash=None if symbol=='ETH' else usdg['runtimeCodeHash'],admissionPath='ADMIN_REVIEWED_WHITELIST',logoUrl=None))
    for a in stocks:
        address=next(d['contractAddress'] for d in a['deployments'] if d['chainId']==4663).lower()
        row=thresholds[address];identity=identities[address];dep=dependencies[identity['beacon'].lower()]
        assert row['assetUid']==a['id'] and row['decimals']==a['tokenDecimals'] and row['symbol']==a['tokenSymbol']
        assert a['status']=='ASSET_STATUS_ACTIVE' and a['tokenDecimals']==18
        assert int(row['phantomQuote'])*5==int(row['graduationThreshold'])*2
        fingerprint=dict(tokenRuntimeCodeHash=identity['codeHash'],beacon=dep['beacon'],beaconRuntimeCodeHash=dep['beaconCodeHash'],implementation=dep['implementation'],implementationRuntimeCodeHash=dep['implementationCodeHash'])
        common=dict(symbol=a['tokenSymbol'],name=a['tokenName'],chainId=4663,tokenAddress=address,decimals=a['tokenDecimals'],assetUid=a['id'],logoUrl=a['logoUrl'])
        assets.append(dict(**common,assetKind='OFFICIAL_STOCK',officialStatus=a['status'],currentMultiplier=a['currentMultiplier'],pendingMultiplier=a.get('pendingMultiplier'),phantomQuote=row['phantomQuote'],graduationThreshold=row['graduationThreshold'],graduationThresholdStatus='APPROVED',thresholdCalculationEvidence=str(STOCK_THRESHOLDS.relative_to(ROOT)),includedInRelease=True,activationStatus='REGISTRY_ACTIVATION_REQUIRED',runtimeCodeHash=identity['codeHash'],expectedFingerprint=fingerprint,admissionPath='ADMIN_REVIEWED_WHITELIST'))
        staking.append(dict(**common,minimumAllocation=str(10**a['tokenDecimals']//2),minimumAllocationTokens='0.5',minimumAllocationBasis='RAW_TOKEN_TOTAL_POSITION',enabled=True,activationStatus='REGISTRY_ACTIVATION_REQUIRED',expectedFingerprint=fingerprint))
    assert len(assets)==196 and len({a['tokenAddress'] for a in assets})==196 and len({a['symbol'] for a in assets})==196
    evidence=[dict(path=str(p.relative_to(ROOT)),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in [DATA/'assets.json',STOCK_THRESHOLDS,LIVE,USDG]]
    base=dict(schemaVersion=1,chainId=4663,status='RELEASE_ASSET_UNIVERSE_SELECTED_NOT_CHAIN_ACTIVATED',selectionSource='USER_ALL_194_OFFICIAL_STOCKS_PLUS_ETH_USDG_2026_09_12',observedAt=official['receivedAt'],evidence=evidence)
    quote=dict(**base,economicsPolicy='ALL_194_STOCK_QUOTES_7000_USD_MID_2DP_ETH_3_USDG_7000_PHANTOM_40_PERCENT',phantomQuoteRatioBps=4000,activationRequirements=['Matching target chain','Own ACTIVE quote config and matching baseline','Administrator risk review and whitelist admission','Exact transfer evidence and finalized deployment preflight','Governance registration receipt; inclusion here never bypasses Registry'],supplyReferenceRaw='1000000000000000000000000000',assets=assets,excluded=[dict(symbol='cbBTC',reason='OUTSIDE_USER_SELECTED_196_QUOTE_UNIVERSE'),dict(symbol='WETH',reason='NATIVE_ETH_SELECTED_NOT_SEPARATE_QUOTE')])
    stake=dict(**base,minimumAllocationTokens='0.5',minimumAllocationBasis='RAW_TOKEN_TOTAL_POSITION',vaultBinding='CANONICAL_RELEASE_USER_STOCK_VAULT_REQUIRED_AT_ACTIVATION',activationRequirements=['Bind canonical deployed UserStockVault','Register all 194 assets with minimumAllocation=500000000000000000','Refresh identity fingerprints before activation','Verify ACTIVE registry state, exact deposits and exits'],assets=staking)
    return quote,stake

if __name__=='__main__':
    quote,stake=generate()
    for path,value in [(OUT,quote),(STAKE_OUT,stake)]:
        output=json.dumps(value,indent=2)+'\n'
        if '--check' in sys.argv:
            if not path.exists() or path.read_text()!=output:raise SystemExit(f'Release catalog drift: {path.name}')
        else:path.write_text(output)
    print('Verified production release: 196 Quotes / 194 Stake assets / 0.5 minimum total stake')
