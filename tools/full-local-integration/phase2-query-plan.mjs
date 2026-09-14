import{writeFileSync}from'node:fs';import{createDatabasePool}from'../../services/backend-ts/packages/db/src/index.ts';import{readGlobalSeries}from'../../services/backend-ts/packages/statistics-store/src/index.ts';import{CURRENT_RELEASE_ID}from'../../services/backend-ts/packages/events/src/index.ts';
const schemaName=process.env.TG_DATABASE_SCHEMA;if(!/^tg_daily_scale_\d+$/.test(schemaName??''))throw Error('owned local schema required');
const{pool}=createDatabasePool('postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden');const query=pool.query.bind(pool),plans=[];
try{const now=Number((await query(`SELECT extract(epoch FROM source_timestamp)::bigint t FROM "${schemaName}".chain_blocks WHERE number=4`)).rows[0].t);pool.query=async(sql,args)=>{if(sql.includes('source AS (')){const plan=await query('EXPLAIN (FORMAT JSON) '+sql,args);plans.push({sql,args,plan:plan.rows});return{rows:[]}}return query(sql,args)};
await readGlobalSeries({pool,deployment:{environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n},schemaName,from:now-86400,to:now,interval:3600});
writeFileSync(new URL('../../docs/reviews/evidence/capacity-phase2-2026-09-14/cold-series-plan.json',import.meta.url),JSON.stringify(plans,null,2)+'\n');console.log(JSON.stringify(plans.map(x=>x.plan)));
}finally{await pool.end()}
