// Local test worker supervisor. Journal recovery never changes nonce or intent.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {readProjectEnv,root} from '../environment.mjs';
const e=readProjectEnv('test'),dir=e.TG_HOLDER_STATE_DIR;
if(!dir||!path.isAbsolute(dir))throw Error('Worker state directory missing');
const command=process.argv[2]||'status',label='com.tickergarden.test-rewards';
if(command==='status'){
 const file=path.join(dir,'journal.json'),state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
 const lock=path.join(dir,'worker.lock');let running=false;
 if(fs.existsSync(lock)){try{process.kill(JSON.parse(fs.readFileSync(lock)).pid,0);running=true}catch{}}
 console.log(JSON.stringify({running,lastCheckAt:state.lastTickAt,nextCheckAt:state.lastTickAt?new Date(Date.parse(state.lastTickAt)+Number(e.TG_HOLDER_INTERVAL_SECONDS||14400)*1000).toISOString():null,lastAttemptAt:state.lastAttemptAt,lastSuccessAt:state.lastSuccessAt,lastError:state.lastError,failedMarkets:state.failedMarkets,markets:state.markets,transactions:(state.transactions??[]).map(({hash,operation,status,fee,block})=>({hash,operation,status,fee,block}))},null,2));
}else if(command==='install'){
 if(process.platform!=='darwin')throw Error('This supervisor supports local macOS only');
 const domain=`gui/${process.getuid()}`;
 // Stop supervision first, otherwise KeepAlive can race the lock handover.
 spawnSync('launchctl',['bootout',`${domain}/${label}`]);
 const lock=path.join(dir,'worker.lock');
 if(fs.existsSync(lock)){
  const {pid}=JSON.parse(fs.readFileSync(lock));
  const actual=spawnSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).stdout||'';
  if(actual.includes('tools/holder-rewards/worker.mjs'))process.kill(pid,'SIGTERM');
  else if(actual.trim())throw Error('Worker lock owner does not match');
  for(let n=0;n<60&&fs.existsSync(lock);n++)await new Promise(r=>setTimeout(r,1000));
  if(fs.existsSync(lock))throw Error('Worker did not stop cleanly; preserve journal and inspect');
 }
 const esc=v=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const folder=path.join(os.homedir(),'Library/LaunchAgents');fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,`${label}.plist`);
 const xml=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[process.execPath,path.join(root,'tools/holder-rewards/worker.mjs'),'--execute','--run'].map(x=>`<string>${esc(x)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${esc(root)}</string><key>EnvironmentVariables</key><dict><key>TG_PROFILE</key><string>test</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer><key>StandardOutPath</key><string>${esc(path.join(dir,'service.log'))}</string><key>StandardErrorPath</key><string>${esc(path.join(dir,'service.log'))}</string></dict></plist>`;
 fs.writeFileSync(file,xml,{mode:0o600});
 const result=spawnSync('launchctl',['bootstrap',domain,file],{encoding:'utf8'});
 if(result.status!==0)throw Error(`Service installation failed: ${result.stderr}`);
 console.log('Test rewards service installed. Use service.mjs status for receipts and failures.');
}else throw Error('Use status or install. Never delete the journal to recover a pending transaction.');
