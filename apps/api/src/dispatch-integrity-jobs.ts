/** Trusted, synthetic-lab, single-pass consumer. No HTTP listener or automatic collection. */
import { isAbsolute } from 'node:path';
import { createPool } from './db.js';
import { dispatchIntegrityJobs, validateDispatch } from './integrity-jobs.js';

async function main() {
  const [tenantId='',caseId='',rawLimit='10',...extra]=process.argv.slice(2);
  const limit=Number(rawLimit);
  validateDispatch({tenantId,caseId},limit);
  if(extra.length || !/^[0-9]+$/.test(rawLimit))throw new Error('Invalid arguments');
  if(process.env.INVEOS_DEV_LAB!=='1' || process.env.NODE_ENV==='production')throw new Error('Lab only');
  const url=process.env.INVEOS_DATABASE_URL??'',root=process.env.INVEOS_STORAGE_ROOT??'';
  if(!/^postgres(ql)?:\/\//.test(url) || !isAbsolute(root))throw new Error('Invalid worker configuration');
  // The worker never reads an administrator URL or runs migrations. This is still the lab application role.
  const pool=createPool(url,process.env.INVEOS_WORKER_SCHEMA??'inveos',2);
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try {
    const receipt=await dispatchIntegrityJobs(pool,root,{tenantId,caseId},limit,controller.signal);
    process.stdout.write(JSON.stringify(receipt)+'\n');
  } finally {
    process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
    await pool.end();
  }
}
main().catch(()=>{
  // Avoid leaking database URLs, paths, source data or lease tokens through an exception stack.
  process.stderr.write('Dispatch failed. Check lab configuration and scoped job history before retrying.\n');
  process.exitCode=1;
});
