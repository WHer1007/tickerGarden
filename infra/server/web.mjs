import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createReadStream} from 'node:fs';
export async function createWebHandler(config,load){
  const root=path.join(config.source,'apps/web/dist'),env=process.env;
  const {securityHeaders}=await load('apps/web/security/headers.mjs');
  const {legacyRedirect}=await load('apps/web/security/legacy-redirects.mjs');
  const rpc=(await load('apps/web/api/rpc.ts')).default;
  const {marketPage}=await load('apps/web/api/market-page.ts');
  const shell=await fs.readFile(path.join(root,'market-shell.html'),'utf8');
  const baseHeaders=securityHeaders({...env,VERCEL_ENV:config.environment==='production'?'production':'preview'});
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon','.txt':'text/plain','.xml':'application/xml'};
  return async request=>{
    const url=new URL(request.url);let relative;try{relative=decodeURIComponent(url.pathname);}catch{return new Response(null,{status:400});}
    if(relative==='/api/rpc')return rpc.fetch(request);
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...baseHeaders,Allow:'GET, HEAD'}});
    const redirect=legacyRedirect(relative);if(redirect)return new Response(null,{status:308,headers:{...baseHeaders,Location:redirect+url.search}});
    if(relative==='/trade'||relative==='/api/market-page'){
      const response=await marketPage(request,shell,env);for(const[k,v]of Object.entries(baseHeaders))response.headers.set(k,v);return response;
    }
    if(relative.includes('\0')||relative.split('/').some(p=>p.startsWith('.'))||relative==='/_headers')return new Response(null,{status:404});
    let file=path.resolve(root,'.'+relative),status=200;
    if(file!==root&&!file.startsWith(root+path.sep))return new Response(null,{status:404});
    try{
      const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,'index.html');await fs.access(file);
    }catch{
      if(path.extname(relative))return new Response(null,{status:404,headers:baseHeaders});
      const known=['/','/explore','/create','/stats','/stats/stocks','/claim','/stake','/docs','/privacy','/terms'].includes(relative.replace(/\/$/,'')||'/');
      file=path.join(root,known?'index.html':'404.html');if(!known)status=404;
    }
    const headers={...baseHeaders,'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':relative.startsWith('/assets/')?'public, max-age=31536000, immutable':file.endsWith('.html')?'no-cache':'public, max-age=3600'};
    return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(file)),{status,headers});
  };
}
