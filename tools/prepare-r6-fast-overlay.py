"""Apply the explicitly test-only R6 profile to an isolated snapshot, never the main sources."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[1]
dst=root/'.codex_tmp/r6-fast-test'
assert dst.is_dir() and dst!=root
if (dst/'r6-fast-profile.json').exists(): raise SystemExit('R6 overlay already exists; refusing to reset a release or transaction journal')
changes=[]
def patch(rel,replacements):
 p=dst/rel;s=p.read_text();old=s
 for a,b in replacements:
  if a not in s:raise ValueError(f'missing expected input: {rel}: {a}')
  s=s.replace(a,b)
 p.write_text(s)
 changes.append({'path':rel,'before':hashlib.sha256(old.encode()).hexdigest(),'after':hashlib.sha256(s.encode()).hexdigest(),'replacements':replacements})
for rel,a,b in [
 ('contracts/src/v1/shared/AllocationManagerIncreases.sol','MINIMUM_LOCK = 24 hours','MINIMUM_LOCK = 20 minutes'),
 ('contracts/src/v1/shared/MemeStockGaugePendingPositions.sol','MINIMUM_POSITION_LOCK = 24 hours','MINIMUM_POSITION_LOCK = 20 minutes'),
 ('contracts/src/v1/shared/DelayedUnpause.sol','UNPAUSE_STATE_DELAY = 1 days','UNPAUSE_STATE_DELAY = 20 minutes'),
 ('contracts/src/v1/shared/ProtocolFeeVaultRewardSettlement.sol','RAW_EXIT_DELAY = 7 days','RAW_EXIT_DELAY = 1 hours'),
 ('contracts/src/v1/modules/TreasuryDistributorV1.sol','EPOCH_DURATION = 7 days','EPOCH_DURATION = 1 hours')]:patch(rel,[(a,b)])
# Adapt only protocol timing expectations in the isolated test copy; arbitrary test timestamps stay intact.
for p in (dst/'contracts/test/v1').rglob('*.sol'):
 if '/fork/' in str(p):continue
 s=p.read_text();repls=[]
 if '24 hours' in s:repls.append(('24 hours','20 minutes'))
 if '7 days' in s:repls.append(('7 days','1 hours'))
 if 'UNPAUSE_DELAY = 1 days' in s:repls.append(('UNPAUSE_DELAY = 1 days','UNPAUSE_DELAY = 20 minutes'))
 if p.name=='VaultGaugeInvariant.t.sol':repls.append(('block.timestamp + 1 days','block.timestamp + 20 minutes'))
 if repls:patch(str(p.relative_to(dst)),repls)
# The production-parameter suite above still tests its explicitly configured 30-day claim values;
# the R6 deployed profile is independently checked against the 2-hour constructor input.
patch('deployments/config/arbitrum-sepolia.public.env',[
 ('V1_CLAIM_WINDOW=2592000','V1_CLAIM_WINDOW=7200'),
 ('V1_ROOT_PUBLICATION_WINDOW=86400','V1_ROOT_PUBLICATION_WINDOW=1200'),
 ('V1_ROOT_REVIEW_DELAY=3600','V1_ROOT_REVIEW_DELAY=300')])
p=dst/'deployments/manifests/arbitrum-sepolia-421614.paired-assets.json';a=json.loads(p.read_text());a['economicsPolicy']='R6_FAST_TEST_ONLY_0_00168_PHANTOM_0_0042_GRADUATION'
for x in a['assets']:
 if x['symbol']=='ETH':x['phantomQuote']='1680000000000000';x['graduationThreshold']='4200000000000000'
p.write_text(json.dumps(a,indent=2)+'\n')
# A fresh release must never reuse R5 broadcast journals or current-address manifests.
for name in ['deployed','activation','transactions','preview']:
 p=dst/f'deployments/manifests/arbitrum-sepolia-421614.v1.{name}.json'
 if p.exists():p.unlink()
profile={'profile':'R6_FAST_TEST_ONLY','chainId':421614,'productionTargetChainId':4663,'productionEligible':False,'parentRelease':'0x14963af9576a3b1cb915b8a13e86e0899a4c8345c010c47d4932789ebf46031d','lockSeconds':1200,'unpauseSeconds':1200,'rawExitSeconds':3600,'epochSeconds':3600,'claimWindowSeconds':7200,'rootPublicationWindowSeconds':1200,'rootReviewSeconds':300,'finalitySeconds':600,'finalityBlocks':2,'graduationWei':'4200000000000000','phantomWei':'1680000000000000','changes':changes}
for p in [root/'outputs/reviews/r6-fast-test-2026-09-06/profile.json',dst/'r6-fast-profile.json']:p.write_text(json.dumps(profile,indent=2)+'\n')
print(json.dumps({'isolatedWorkspace':str(dst),'patchedFiles':len(changes),'profile':'R6_FAST_TEST_ONLY'}))
