import {readFile} from 'node:fs/promises';
import {summarizeRpcUsage} from '../packages/rpc-control/src/meter.ts';
const files=process.argv.slice(2);if(!files.length)throw Error('Usage: summarize-rpc-usage.ts <JSONL log files...>');
const records:Record<string,unknown>[]=[];let unreadableLines=0;
for(const file of files){for(const line of (await readFile(file,'utf8')).split('\n')){if(!line.trim())continue;try{const offset=line.indexOf('{');if(offset<0)continue;const r=JSON.parse(line.slice(offset));if(r&&typeof r==='object')records.push(r);}catch{unreadableLines++;}}}
console.log(JSON.stringify({rows:summarizeRpcUsage(records),unreadableLines,credits:null,note:'Compare HTTP methods and WS received messages with provider dashboard for the same UTC window. Credits require the account method tariff; request counts are not credits.'},null,2));
