#!/usr/bin/env python3
"""Public, read-only Robinhood metadata snapshot and logo availability check."""
import concurrent.futures, datetime, hashlib, json, pathlib, sys, time, urllib.request
OUT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/reviews/rh-mainnet-stock-catalog-2026-09-12')
(OUT/'raw').mkdir(parents=True,exist_ok=True)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(name,obj): (OUT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
receipts=[]
for resource in ['assets','prices','corporate-actions']:
 url='https://api.robinhood.com/rhj/'+resource
 start=now();t=time.monotonic()
 with urllib.request.urlopen(url,timeout=30) as r:
  data=r.read();headers=dict(r.headers);status=r.status
 (OUT/'raw'/f'{resource}.json').write_bytes(data)
 receipts.append(dict(url=url,startedAt=start,receivedAt=now(),durationSeconds=round(time.monotonic()-t,3),status=status,headers=headers,sha256=hashlib.sha256(data).hexdigest()))
save('raw/http-receipts.json',receipts)
assets=json.loads((OUT/'raw/assets.json').read_text())['assets']
def logo(a):
 url=a.get('logoUrl');r=dict(symbol=a['tokenSymbol'],url=url,checkedAt=now())
 if not url:return dict(r,status='MISSING_URL')
 try:
  req=urllib.request.Request(url,method='HEAD')
  with urllib.request.urlopen(req,timeout=12) as h:
   r.update(status=h.status,contentType=h.headers.get('Content-Type'),contentLength=h.headers.get('Content-Length'),etag=h.headers.get('ETag'),finalUrl=h.url)
 except Exception as e:r.update(status=getattr(e,'code',None),error=type(e).__name__)
 return r
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex: rows=list(ex.map(logo,assets))
save('raw/logo-checks.json',rows)
print(json.dumps(dict(assets=len(assets),logosAvailable=sum(r.get('status')==200 for r in rows),finishedAt=now())))
