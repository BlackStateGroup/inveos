/** Fictional process-death test only. The parent kills this after the committed claim. */
import { createPool } from '../../src/db.js';
import { claimIntegrityJob } from '../../src/integrity-jobs.js';
const [tenantId,caseId,jobId]=process.argv.slice(2);
if(!tenantId || !caseId || !jobId)throw new Error('Missing test identifiers');
const pool=createPool(process.env.INVEOS_DATABASE_URL!,process.env.INVEOS_WORKER_SCHEMA!);
if(!await claimIntegrityJob(pool,{tenantId,caseId,jobId}))throw new Error('Claim failed');
process.stdout.write('claimed\n');
setInterval(()=>{},1000);
