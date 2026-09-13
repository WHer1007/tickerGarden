import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

const MIGRATIONS = ['0001_core', '0002_queue_generation_fence', '0003_recent_markets', '0004_holder_rewards'] as const;
type MigrationVersion = typeof MIGRATIONS[number];

function migrationPath(version: MigrationVersion = MIGRATIONS[0]): string {
  if (!MIGRATIONS.includes(version)) throw new Error('unknown migration version');
  const besideModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../migrations/${version}.sql`);
  if (fs.existsSync(besideModule)) return besideModule;
  const fromWorkspace = path.resolve(process.cwd(), `packages/db/migrations/${version}.sql`);
  if (fs.existsSync(fromWorkspace)) return fromWorkspace;
  throw new Error(`${version}.sql was not found`);
}

export function migrationSql(schemaName = 'tickergarden_serverless', version: MigrationVersion = MIGRATIONS[0]): string {
  if (!IDENTIFIER.test(schemaName)) throw new Error('invalid database schema name');
  return fs.readFileSync(migrationPath(version), 'utf8').replaceAll('{{schema}}', schemaName);
}

export function coreMigrationDigest(version: MigrationVersion = MIGRATIONS[0]): `0x${string}` {
  return `0x${createHash('sha256').update(fs.readFileSync(migrationPath(version))).digest('hex')}`;
}

export function migrationManifest(): ReadonlyArray<{ version: MigrationVersion; digest: `0x${string}` }> {
  return MIGRATIONS.map((version) => ({ version, digest: coreMigrationDigest(version) }));
}

export async function applyCoreMigration(pool: Pool, schemaName = 'tickergarden_serverless'): Promise<boolean> {
  if (!IDENTIFIER.test(schemaName)) throw new Error('invalid database schema name');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`tickergarden:migration:${schemaName}`]);
    const existing = await client.query<{ migration_table: string | null }>(
      'SELECT to_regclass($1)::text AS migration_table',
      [`${schemaName}.schema_migrations`],
    );
    if (!existing.rows[0]?.migration_table) {
      const namespace = await client.query<{ present: boolean }>('SELECT to_regnamespace($1) IS NOT NULL AS present', [schemaName]);
      if (namespace.rows[0]?.present) throw new Error('database schema exists without migration history');
    }
    let changed = false;
    for (const version of MIGRATIONS) {
      const applied = existing.rows[0]?.migration_table || changed
        ? await client.query<{ digest: string | null }>(
          `SELECT digest FROM ${quoteIdentifier(schemaName)}.schema_migrations WHERE version = $1`, [version],
        )
        : { rowCount: 0, rows: [] as Array<{ digest: string | null }> };
      if (applied.rowCount) {
        if (applied.rows[0]?.digest !== coreMigrationDigest(version)) throw new Error(`applied migration digest does not match source: ${version}`);
        continue;
      }
      if (existing.rows[0]?.migration_table && version === MIGRATIONS[0]) throw new Error('database schema exists without the expected core migration');
      if (version !== MIGRATIONS[0] && !existing.rows[0]?.migration_table && !changed) throw new Error('database schema exists without the expected core migration');
      await client.query(migrationSql(schemaName, version));
      await client.query(
        `UPDATE ${quoteIdentifier(schemaName)}.schema_migrations SET digest = $1 WHERE version = $2`,
        [coreMigrationDigest(version), version],
      );
      changed = true;
    }
    await client.query('COMMIT');
    return changed;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the migration error; a closed connection cannot be rolled back.
  }
}
