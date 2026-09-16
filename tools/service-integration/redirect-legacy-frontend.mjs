import http from 'node:http';
// Keep old integration bookmarks usable without loading stale release settings.
const target='http://127.0.0.1:5178';
http.createServer((req,res)=>{
 const path=new URL(req.url??'/', 'http://127.0.0.1:5176');
 res.writeHead(307,{Location:target+path.pathname+path.search,'Cache-Control':'no-store'});res.end('Integration frontend moved to '+target);
}).listen(5176,'127.0.0.1',()=>console.log('Legacy frontend 5176 redirects to integration 5178'));
