"""Read-only discovery identity/restart audit; does not attest API publication."""
import json,pathlib,subprocess,datetime
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'outputs/reviews/continuous-service-2026-09-07'
url=json.loads((out/'database.json').read_text())['url']
assert '@127.0.0.1:' in url
sources=[json.loads((root/f'outputs/reviews/{n}-2026-09-07/results.json').read_text()) for n in ['continuous-public-acceptance','continuous-v4-public','continuous-edge-public']]
assert len({s['releaseId'] for s in sources})==1
expected={m['id']:m for s in sources for m in s['markets'].values()}
assert len(expected)==5
query="SELECT row_to_json(x) FROM (SELECT m.market_id,m.payload,b.number,b.hash,b.canonical,b.receipts_verified FROM tickergarden.canonical_discovered_markets m JOIN tickergarden.chain_blocks b ON b.chain_id=m.chain_id AND b.hash=m.block_hash WHERE m.chain_id=421614) x"
r=subprocess.run(['psql',url,'-X','-At','-v','ON_ERROR_STOP=1','-c',query],capture_output=True,text=True,check=True)
rows=[json.loads(x) for x in r.stdout.splitlines()]
assert len(rows)==5 and {r['market_id'] for r in rows}==set(expected)
verified=[]
for row in rows:
 m=expected[row['market_id']];actual=row['payload'];state=actual['state'];event=actual['source']
 assert row['canonical'] and row['receipts_verified'] and event['blockHash']==row['hash']
 assert int(event['blockNumber'],16)==row['number'] and not event['removed']
 for k,v in [('memeToken',m['token']),('curve',m['curve'])]:assert state[k].lower()==v.lower()
 if 'quote' in m:assert state['quoteAsset'].lower()==m['quote'].lower()
 assert any(t['hash']==event['transactionHash'] for s in sources for t in s['transactions'])
 assert state['creatorFeesToHolders'] is True
 assert state['stakingEnabled']==(state['gauge']!='0x'+'0'*40)
 verified.append({'marketId':m['id'],'creationBlock':row['number'],'creationHash':row['hash'],'transactionHash':event['transactionHash'],'token':state['memeToken'],'curve':state['curve'],'stakingEnabled':state['stakingEnabled']})
result={'status':'DISCOVERY_IDENTITY_PASS','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseId':sources[0]['releaseId'],'markets':verified,'scope':'Persisted discovered identities match five actual runner-created markets and receipt-verified canonical journal. Does not attest business projection, economic balances or API publication.'}
(out/'discovery-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':result['status'],'markets':len(verified)}))
