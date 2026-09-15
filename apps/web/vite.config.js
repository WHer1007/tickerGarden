import docsPage from "./src/pages/docs.ts";
import privacyPage from "./src/pages/privacy.ts";
import termsPage from "./src/pages/terms.ts";
import risksPage from "./src/pages/risks.ts";
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import {readProjectEnv,serviceEnvironment,currentBranch,root} from '../../tools/environment.mjs';
import {securityHeaders} from './security/headers.mjs';
export default defineConfig(({command})=>{
 const profile=process.env.TG_PROFILE||currentBranch();
 // Ignored local profiles are convenient for the dev server, but deployment
 // builds must receive their environment explicitly from the deployment host.
 if(command==='serve'&&fs.existsSync(`${root}/.env.${profile.startsWith('codex/')?'test':profile}.local`))Object.assign(process.env,serviceEnvironment(readProjectEnv(profile),'web'));
 if(command==='build'){
  if(process.env.VITE_INTEGRATION_BOOTSTRAP)throw Error('Deployment builds cannot use the local integration bootstrap');
  for(const key of ['VITE_V1_READ_API_URL','VITE_LAUNCH_METADATA_ORIGIN','VITE_V1_RPC_URL']){
   const value=process.env[key];if(!value||(key==='VITE_V1_RPC_URL'&&value==='/api/rpc'))continue;
   let url;try{url=new URL(value);}catch{throw Error(`Deployment build has an invalid ${key}`);}
   if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error(`Deployment build cannot use a local ${key}`);
  }
 }
 return ({
 appType:'spa',envDir:false,
 build:{manifest:true,rollupOptions:{output:{onlyExplicitManualChunks:true,manualChunks(id){
  if(id.includes('vite/preload-helper'))return 'preload';
  if(id.includes("/src/controllers/create.ts"))return "create-controller";
  if(id.includes("/src/controllers/trade.ts"))return "trade-controller";
  if(id.includes("/src/create/generated/"))return "asset-catalogs";
  const abi=id.match(/\/generated\/contracts\/(current|burn|legacy)\/([^/]+)\.ts$/);
  if(abi)return `abi-${abi[1]}-${abi[2]}`;
  if(id.includes('/node_modules/')&&!id.includes('/node_modules/three/')&&!id.includes('/node_modules/@phosphor-icons/'))return 'chain';
  if(id.includes('/node_modules/@phosphor-icons/'))return 'icons';
 }}}},
 server:{headers:securityHeaders(process.env,true)},
 preview:{headers:securityHeaders(process.env,false)},
 plugins:[
  {name:"bundle-audit",generateBundle(_,bundle){if(process.env.TG_BUNDLE_ANALYZE){fs.mkdirSync(path.join(root,"outputs"),{recursive:true});fs.writeFileSync(path.join(root,"outputs/controller-bundle.json"),JSON.stringify(Object.values(bundle).filter(x=>x.type==="chunk").map(x=>({file:x.fileName,imports:x.imports,dynamic:x.dynamicImports,modules:Object.entries(x.modules).map(([id,m])=>({id,length:m.renderedLength}))})),null,2));}}},
  {name:'prerender-public-documents',writeBundle(){if(command==='build'){
   const output=path.join(root,'apps/web/dist');const shell=fs.readFileSync(path.join(output,'index.html'),'utf8');
   for(const [route,page] of Object.entries({docs:docsPage,privacy:privacyPage,terms:termsPage,risks:risksPage})){
    const html=shell.replace(/<noscript>[\s\S]*?<\/noscript>/,'').replace(/<title>.*?<\/title>/,`<title>${page.title}</title>`).replace('<div data-route-outlet></div>',`<div data-route-outlet>${page.html.replace('<main ', '<main id="main-content" ')}</div>`);
    fs.mkdirSync(path.join(output,route),{recursive:true});fs.writeFileSync(path.join(output,route,'index.html'),html);
   }
  }}},
  {name:'production-security-headers',generateBundle(){this.emitFile({type:'asset',fileName:'_headers',source:'/*\n'+Object.entries(securityHeaders(process.env,false)).map(([k,v])=>`  ${k}: ${v}`).join('\n')+'\n'});}},
  {name:'exclude-local-integration-fixtures',closeBundle(){if(command==='build')fs.rmSync(path.join(root,'apps/web/dist/integration'),{recursive:true,force:true});}},
 ],
 });
});
