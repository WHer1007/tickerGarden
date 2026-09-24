import {sentryVitePlugin} from '@sentry/vite-plugin';
import {prerender} from './scripts/prerender.mjs';
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
 const uploadMaps=command==='build'&&!!process.env.SENTRY_AUTH_TOKEN;
 const sourceReleasePath=path.join(root,'source-release.json');
 let sourceRelease;
 if(fs.existsSync(sourceReleasePath)){try{sourceRelease=JSON.parse(fs.readFileSync(sourceReleasePath,'utf8'));}catch{throw Error('Invalid source-release.json provenance');}}
 const releaseCommit=sourceRelease?.commit??process.env.VITE_RELEASE_COMMIT??process.env.VERCEL_GIT_COMMIT_SHA??'unconfigured';
 if(uploadMaps&&(!process.env.SENTRY_ORG||!process.env.SENTRY_PROJECT))throw Error('Sentry source-map upload requires org and project');
 return ({
 appType:'spa',envDir:false,
 define:{'import.meta.env.VITE_RELEASE_COMMIT':JSON.stringify(releaseCommit),'import.meta.env.VITE_TG_ENVIRONMENT':JSON.stringify(process.env.VITE_TG_ENVIRONMENT??(process.env.TG_PROFILE==='master'?'production':process.env.TG_PROFILE==='test'?'test':'local'))},
 build:{sourcemap:uploadMaps?'hidden':false,manifest:true,rollupOptions:{output:{onlyExplicitManualChunks:true,manualChunks(id){
  if(id.includes('/node_modules/@sentry/'))return 'observability';
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
  ...(uploadMaps?[sentryVitePlugin({org:process.env.SENTRY_ORG,project:process.env.SENTRY_PROJECT,authToken:process.env.SENTRY_AUTH_TOKEN,telemetry:false,release:{name:releaseCommit},sourcemaps:{filesToDeleteAfterUpload:['./dist/**/*.map']}})]:[]),
  {name:"bundle-audit",generateBundle(_,bundle){if(process.env.TG_BUNDLE_ANALYZE){fs.mkdirSync(path.join(root,"outputs"),{recursive:true});fs.writeFileSync(path.join(root,"outputs/controller-bundle.json"),JSON.stringify(Object.values(bundle).filter(x=>x.type==="chunk").map(x=>({file:x.fileName,imports:x.imports,dynamic:x.dynamicImports,modules:Object.entries(x.modules).map(([id,m])=>({id,length:m.renderedLength}))})),null,2));}}},
  {name:'prerender-public-pages',writeBundle(){if(command==='build')prerender(path.join(root,'apps/web/dist'),process.env);}},
  {name:'production-security-headers',generateBundle(){this.emitFile({type:'asset',fileName:'_headers',source:'/*\n'+Object.entries(securityHeaders(process.env,false)).map(([k,v])=>`  ${k}: ${v}`).join('\n')+'\n'});}},
  {name:'exclude-local-integration-fixtures',closeBundle(){if(command==='build')fs.rmSync(path.join(root,'apps/web/dist/integration'),{recursive:true,force:true});}},
 ],
 });
});
