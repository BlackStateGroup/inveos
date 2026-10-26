import { createPool, runMigrations } from './db.js';
import { loadRuntimeConfig } from './config.js';

const config = loadRuntimeConfig();
const pool = createPool(config.adminDatabaseUrl, 'public', 2);

try {
  await runMigrations(pool, 'inveos');
  process.stdout.write('Local INVEOS schema migration completed.\n');
} finally {
  await pool.end();
}
