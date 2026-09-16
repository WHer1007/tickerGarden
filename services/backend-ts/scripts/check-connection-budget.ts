import {readFile,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {evaluateConnectionBudget,connectionRoleLimitsSql,type ConnectionBudgetInput} from '../packages/db/src/connection-budget.ts';
const [file,mode='--check']=process.argv.slice(2);
if(!file||!['--check','--plan'].includes(mode))throw Error('usage: check-connection-budget.ts policy.json [--check|--plan]');
const policy=JSON.parse(await readFile(file,'utf8')) as {budget:ConnectionBudgetInput;roles:Record<string,string>};
const budget=evaluateConnectionBudget(policy.budget),sql=connectionRoleLimitsSql(policy.budget,policy.roles);
if(mode==='--plan'){await writeFile(`${file}.sql`,sql+'\n',{mode:0o600});console.log(JSON.stringify({budget,sqlFile:`${file}.sql`}));}
else{
 const url=process.env.TG_MIGRATION_DATABASE_URL;if(!url)throw Error('TG_MIGRATION_DATABASE_URL required');
 const pool=new Pool({connectionString:url,max:1});
 try{
  const max=Number((await pool.query('SHOW max_connections')).rows[0].max_connections);
  if(max!==policy.budget.maxConnections)throw Error('live max_connections differs from budget');
  const rows=(await pool.query<{rolname:string;rolconnlimit:number;rolsuper:boolean;rolcanlogin:boolean}>(`SELECT rolname,rolconnlimit,rolsuper,rolcanlogin FROM pg_roles WHERE rolcanlogin`)).rows;
  const planned=new Map(sql.split('\n').map(line=>{const m=line.match(/"([^"]+)" CONNECTION LIMIT (\d+)/)!;return[m[1],Number(m[2])] as const;}));
  for(const [role,limit]of planned){const r=rows.find(r=>r.rolname===role);if(!r||r.rolsuper||r.rolconnlimit!==limit)throw Error(`role hard cap missing or incorrect: ${role}`);}
  for(const r of rows)if(!r.rolsuper&&!planned.has(r.rolname))throw Error(`unbudgeted login role: ${r.rolname}`);
  const active=(await pool.query('SELECT usename,count(*)::int connections FROM pg_stat_activity GROUP BY usename')).rows;
  console.log(JSON.stringify({ok:true,budget,active}));
 }finally{await pool.end();}
}
