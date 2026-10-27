import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient, type PoolConfig } from 'pg';

const schemaPattern = /^[a-z][a-z0-9_]{0,62}$/;

export function createPool(connectionString: string, schema = 'inveos', max = 10): Pool {
  if (!schemaPattern.test(schema)) {
    throw new Error('Invalid database schema name.');
  }
  const config: PoolConfig = {
    connectionString,
    max,
    options: `-c search_path=${schema},public`,
  };
  return new Pool(config);
}

export async function runMigrations(pool: Pool, schema = 'inveos'): Promise<void> {
  if (!schemaPattern.test(schema)) {
    throw new Error('Invalid database schema name.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), 492716)', [schema]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}" AUTHORIZATION CURRENT_USER`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = new URL('../migrations/', import.meta.url);
    const names = (await readdir(directory)).filter((name) => /^\d{3}_[a-z_]+\.sql$/.test(name)).sort();
    for (const name of names) {
      const migration = await readFile(fileURLToPath(new URL(name, directory)), 'utf8');
      const digest = createHash('sha256').update(migration).digest('hex');
      const applied = await client.query('SELECT sha256 FROM schema_migrations WHERE filename = $1', [name]);
      if (applied.rows[0]) {
        if (applied.rows[0].sha256 !== digest) throw new Error(`Applied migration was modified: ${name}`);
        continue;
      }
      await client.query(migration);
      await client.query('INSERT INTO schema_migrations (filename, sha256) VALUES ($1, $2)', [name, digest]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function inTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
