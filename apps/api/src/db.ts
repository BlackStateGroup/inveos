import { readFile } from 'node:fs/promises';
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
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}" AUTHORIZATION CURRENT_USER`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    const migrationPath = fileURLToPath(new URL('../migrations/001_foundation.sql', import.meta.url));
    const migration = await readFile(migrationPath, 'utf8');
    await client.query(migration);
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
