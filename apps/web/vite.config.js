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
   const value=process.env[key];if(!value)continue;
   let url;try{url=new URL(value);}catch{throw Error(`Deployment build has an invalid ${key}`);}
   if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error(`Deployment build cannot use a local ${key}`);
  }
 }
 return ({
 appType:'spa',envDir:false,
 build:{rollupOptions:{output:{manualChunks(id){
  if(id.includes('/node_modules/viem/')||id.includes('/node_modules/@noble/')||id.includes('/node_modules/abitype/'))return 'chain';
  if(id.includes('/node_modules/@phosphor-icons/'))return 'icons';
 }}}},
 server:{headers:securityHeaders(process.env,true)},
 preview:{headers:securityHeaders(process.env,false)},
 plugins:[
  {name:'production-security-headers',generateBundle(){this.emitFile({type:'asset',fileName:'_headers',source:'/*\n'+Object.entries(securityHeaders(process.env,false)).map(([k,v])=>`  ${k}: ${v}`).join('\n')+'\n'});}},
  {name:'exclude-local-integration-fixtures',closeBundle(){if(command==='build')fs.rmSync(path.join(root,'apps/web/dist/integration'),{recursive:true,force:true});}},
 ],
 });
});
