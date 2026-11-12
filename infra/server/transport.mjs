import http from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Exact configured origins only: preserve callback URL identity while using private transport.
export function mappedFetch(routes, nativeFetch=globalThis.fetch) {
  const entries=Object.entries(routes).sort(([a],[b])=>b.length-a.length);
  for(const [from,to] of entries){
    const source=new URL(from),target=new URL(to);
    if(source.protocol!=='https:'||source.username||source.password||source.search||source.hash||target.protocol!=='http:'||!/^172\.18\.0\.\d+$/.test(target.hostname)||target.username||target.password||target.search||target.hash)throw Error('Invalid private transport route');
  }
  return async(input,init)=>{
    const original=new Request(input,init),url=new URL(original.url);
    const match=entries.find(([from])=>url.href===from||url.href.startsWith(from.endsWith('/')?from:from+'/')||url.href.startsWith(from+'?'));
    if(!match){
      if(url.hostname==='vercel.app'||url.hostname.endsWith('.vercel.app'))throw Error('Unmapped Vercel request blocked');
      return nativeFetch(original);
    }
    const [from,to]=match,source=new URL(from),target=new URL(to);
    target.pathname=target.pathname.replace(/\/$/,'')+url.pathname.slice(source.pathname.replace(/\/$/,'').length);
    target.search=url.search;
    const headers=new Headers(original.headers);
    headers.set('host',url.host);headers.set('x-forwarded-host',url.host);headers.set('x-forwarded-proto','https');
    return nativeFetch(new Request(target,{method:original.method,headers,signal:original.signal,redirect:'manual',...(['GET','HEAD'].includes(original.method)?{}:{body:original.body,duplex:'half'})}));
  };
}

export function serveFetch(handler,{host='172.18.0.1',port}){
  const server=http.createServer(async(req,res)=>{
    const controller=new AbortController();
    res.once('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      const proto=req.headers['x-forwarded-proto']==='https'?'https':'http';
      const request=new Request(`${proto}://${req.headers['x-forwarded-host']??req.headers.host??'localhost'}${req.url}`,{method:req.method,headers:req.headers,signal:controller.signal,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
      const response=await handler(request);
      const headers=Object.fromEntries(response.headers);const cookies=response.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
      res.writeHead(response.status,headers);
      if(response.body&&req.method!=='HEAD')await pipeline(Readable.fromWeb(response.body),res);else{await response.body?.cancel();res.end();}
    }catch(error){
      if(controller.signal.aborted)return;
      console.error(JSON.stringify({event:'server_request_failed',error:error.name}));
      if(!res.headersSent)res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"internal_error"}');
    }
  });
  server.headersTimeout=15000;server.requestTimeout=30000;server.keepAliveTimeout=5000;
  server.listen(port,host);return server;
}
