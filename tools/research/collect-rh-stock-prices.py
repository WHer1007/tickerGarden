#!/usr/bin/env python3
import concurrent.futures,datetime,json,pathlib,sys,urllib.request,urllib.parse,time
p=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/reviews/rh-mainnet-stock-catalog-2026-09-12')
a=json.loads((p/'raw/assets.json').read_text())['assets']
def fetch(a):
 url='https://api.robinhood.com/rhj/prices/'+urllib.parse.quote(a['tokenSymbol'],safe='');s=time.monotonic()
 r={'symbol':a['tokenSymbol'],'url':url}
 try:
  with urllib.request.urlopen(url,timeout=15) as h:r.update(status=h.status,response=json.load(h))
 except Exception as e:r.update(status=getattr(e,'code',None),error=type(e).__name__)
 r.update(receivedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),durationSeconds=round(time.monotonic()-s,3));return r
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as e:r=list(e.map(fetch,a))
(p/'raw/prices-by-symbol.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print('prices',len(r),'success',sum(x.get('status')==200 for x in r))
