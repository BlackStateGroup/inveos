import { createApp } from './app.js';
import { loadRuntimeConfig } from './config.js';
import { createPool } from './db.js';

const config = loadRuntimeConfig();
const pool = createPool(config.databaseUrl, 'inveos');
const app = await createApp({
  pool,
  documentLab: config.documentLab,
  storageRoot: config.storageRoot,
  allowedOrigins: config.allowedOrigins,
  demoTenantId: config.demoTenantId,
  demoUserId: config.demoUserId,
  sessionTtlSeconds: config.sessionTtlSeconds,
  sessionEpoch: config.sessionEpoch,
});

try {
  const address = await app.listen({host: config.host, port: config.port});
  process.stdout.write(`Local synthetic API listening at ${address}\n`);
} catch (error) {
  await app.close();
  await pool.end();
  throw error;
}

const shutdown = async (): Promise<void> => {
  await app.close();
  await pool.end();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
