/** One scoped original-byte integrity check; no parser or automatic collection. */
import { loadRuntimeConfig } from './config.js';
import { createPool } from './db.js';
import { runIntegrityJob } from './integrity-jobs.js';
const [tenantId,caseId,jobId,...extra] = process.argv.slice(2);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!tenantId || !caseId || !jobId || extra.length || ![tenantId,caseId,jobId].every(x=>uuid.test(x))) {
  throw new Error('Supply tenant, case and job UUIDs.');
}
const config=loadRuntimeConfig();const pool=createPool(config.databaseUrl);
try {
  const result=await runIntegrityJob(pool,config.storageRoot,{tenantId,caseId,jobId});
  process.stdout.write(JSON.stringify(result ?? {status:'not_claimed'})+'\n');
} finally { await pool.end(); }
