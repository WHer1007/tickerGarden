import {legacyRedirect} from './legacy-redirects.mjs';
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {securityHeaders} from './headers.mjs';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
// Build-generated CSP preserves the same endpoint allowlist as the bundled app.
const built=fs.readFileSync(path.join(root,'_headers'),'utf8');
const headers=Object.fromEntries(built.split('\n').filter(l=>l.startsWith('  ')).map(l=>{const i=l.indexOf(':');return[l.slice(2,i),l.slice(i+1).trim()]}));
for(const key of Object.keys(securityHeaders()))if(!headers[key])throw Error(`Missing build security header: ${key}`);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
http.createServer((req,res)=>{
 for(const [k,v]of Object.entries(headers))res.setHeader(k,v);
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 let relative;try{relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400);res.end();return}
 const redirect=legacyRedirect(relative);if(redirect){res.writeHead(308,{Location:redirect+new URL(req.url,'http://localhost').search});res.end();return}
 if(relative.includes('\0')||relative.split('/').some(s=>s.startsWith('.'))||relative==='/_headers'){res.writeHead(404);res.end();return}
 let file=path.resolve(root,'.'+relative);if(file!==path.resolve(root)&&!file.startsWith(root)){res.writeHead(404);res.end();return}
 try{if(fs.statSync(file).isDirectory())file=fs.existsSync(path.join(file,'index.html'))?path.join(file,'index.html'):path.join(root,'index.html')}catch{if(path.extname(relative)){res.writeHead(404);res.end();return}const known=['/','/explore','/trade','/create','/stats','/stats/stocks','/claim','/stake','/docs','/privacy','/terms'].includes(relative.replace(/\/$/,'')||'/');file=path.join(root,known?'index.html':'404.html');if(!known)res.statusCode=404;}
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control',file.endsWith('index.html')?'no-cache':'public, max-age=3600');
 if(req.method==='HEAD'){res.end();return}const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
}).listen(Number(process.env.PORT||4173),process.env.HOST||'127.0.0.1');
