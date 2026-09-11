import { defineConfig } from 'vite';
import fs from 'node:fs';
import {readProjectEnv,serviceEnvironment,currentBranch,root} from '../../tools/environment.mjs';
import {securityHeaders} from './security/headers.mjs';
const profile=process.env.TG_PROFILE||currentBranch();
if(fs.existsSync(`${root}/.env.${profile.startsWith('codex/')?'test':profile}.local`))Object.assign(process.env,serviceEnvironment(readProjectEnv(profile),'web'));
export default defineConfig(({command})=>({
 appType:'spa',envDir:false,
 server:{headers:securityHeaders(process.env,true)},
 preview:{headers:securityHeaders(process.env,false)},
 plugins:[{name:'production-security-headers',generateBundle(){this.emitFile({type:'asset',fileName:'_headers',source:'/*\n'+Object.entries(securityHeaders(process.env,false)).map(([k,v])=>`  ${k}: ${v}`).join('\n')+'\n'});}}],
}));
