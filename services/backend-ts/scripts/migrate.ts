import { applyCoreMigration, createDatabasePool, migrationManifest, permissionsSql, transaction } from '../packages/db/src/index.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error('TG_MIGRATION_DATABASE_URL is required');

const schemaName = process.env.TG_DATABASE_SCHEMA ?? 'tickergarden_serverless';
const readApi = process.env.TG_DB_ROLE_READ_API;
const content = process.env.TG_DB_ROLE_CONTENT;
const pipeline = process.env.TG_DB_ROLE_PIPELINE;
if (!readApi || !content || !pipeline) {
  throw new Error('TG_DB_ROLE_READ_API, TG_DB_ROLE_CONTENT and TG_DB_ROLE_PIPELINE are required');
}

const handle = createDatabasePool(connectionString, { max: 1 });
try {
  const applied = await applyCoreMigration(handle.pool, schemaName);
  await transaction(handle.pool, async (client) => {
    await client.query(permissionsSql(schemaName, { readApi, content, pipeline }));
  });
  console.log(JSON.stringify({ migrations: migrationManifest(), schema: schemaName, applied, permissions: 'applied' }));
} finally {
  await handle.pool.end();
}
