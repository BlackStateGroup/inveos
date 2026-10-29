import {sessionEpoch} from './session-epoch.js';
import { isAbsolute } from 'node:path';

export type RuntimeConfig = {
  host: '127.0.0.1';
  port: number;
  databaseUrl: string;
  adminDatabaseUrl: string;
  storageRoot: string;
  allowedOrigins: string[];
  demoTenantId: string;
  demoUserId: string;
  sessionTtlSeconds: number;
  sessionEpoch: string;
  documentLab: boolean;
};

const defaultOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  if (env.INVEOS_DEV_LAB !== '1') {
    throw new Error('Set INVEOS_DEV_LAB=1 to run the local-only development API.');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('The local development API refuses NODE_ENV=production.');
  }

  const host = env.INVEOS_API_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') {
    throw new Error('The local development API only binds to 127.0.0.1.');
  }

  const port = Number(env.INVEOS_API_PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INVEOS_API_PORT must be a valid TCP port.');
  }

  const databaseUrl = env.INVEOS_DATABASE_URL ?? '';
  const adminDatabaseUrl = env.INVEOS_ADMIN_DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    throw new Error('INVEOS_DATABASE_URL must be a PostgreSQL URL.');
  }
  if (!adminDatabaseUrl.startsWith('postgres://') && !adminDatabaseUrl.startsWith('postgresql://')) {
    throw new Error('INVEOS_ADMIN_DATABASE_URL must be a PostgreSQL URL.');
  }

  const storageRoot = env.INVEOS_STORAGE_ROOT ?? '';
  if (!isAbsolute(storageRoot)) {
    throw new Error('INVEOS_STORAGE_ROOT must be an absolute local path.');
  }

  const allowedOrigins = env.INVEOS_ALLOWED_ORIGINS === undefined
    ? defaultOrigins
    : env.INVEOS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!allowedOrigins.length) {
    throw new Error('INVEOS_ALLOWED_ORIGINS must explicitly list at least one exact origin.');
  }
  for (const origin of allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('INVEOS_ALLOWED_ORIGINS must contain exact origin URLs.');
    }
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('INVEOS_ALLOWED_ORIGINS must contain exact origin URLs without paths or wildcards.');
    }
  }

  const demoTenantId = env.INVEOS_DEMO_TENANT_ID ?? '00000000-0000-4000-8000-000000000001';
  const demoUserId = env.INVEOS_DEMO_USER_ID ?? '00000000-0000-4000-8000-000000000002';
  if (!uuidPattern.test(demoTenantId) || !uuidPattern.test(demoUserId)) {
    throw new Error('Demo tenant and user identifiers must be UUIDs.');
  }

  const sessionTtlSeconds = Number(env.INVEOS_SESSION_TTL_SECONDS ?? '28800');
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 60 || sessionTtlSeconds > 86400) {
    throw new Error('INVEOS_SESSION_TTL_SECONDS must be between 60 and 86400.');
  }

  return {
    documentLab: env.INVEOS_DOCUMENT_LAB === '1',
    host,
    port,
    databaseUrl,
    adminDatabaseUrl,
    storageRoot,
    allowedOrigins,
    demoTenantId,
    demoUserId,
    sessionTtlSeconds,
    sessionEpoch: sessionEpoch(env.INVEOS_SESSION_EPOCH),
  };
}
