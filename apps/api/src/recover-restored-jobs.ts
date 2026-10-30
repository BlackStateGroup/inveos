/** Explicit, bounded lab recovery command. Does not restore data or start workers. */
import {createPool} from './db.js';
import {retireRestoredJobs} from './recover-jobs.js';
import {quarantineRestoredCase,validateRestoredCaseRequest,type RestoredCaseRequest} from './restored-case-quarantine.js';
async function main(){
 const args=process.argv.slice(2);
 if(args[0]==='--quarantine-case'){
  const [mode,flag,tenantId='',caseId='',actorId='',requestId='',backupSha256='',batch='',limit='',reason='',...extra]=args;
  if(mode!=='--quarantine-case'||flag!=='--confirm-quiesced'||extra.length||process.env.INVEOS_DEV_LAB!=='1'||!['development','test'].includes(process.env.NODE_ENV??''))throw new Error('Explicit non-production quarantine only');
  const q:RestoredCaseRequest={tenantId,caseId,actorId,requestId,backupSha256,batch:Number(batch),limit:Number(limit),reason,quiesced:true};
  if(!/^[1-9][0-9]*$/.test(batch)||!/^[1-9][0-9]*$/.test(limit))throw new Error('Explicit batch and limit required');
  validateRestoredCaseRequest(q);
  const database=process.env.INVEOS_DATABASE_URL??'',url=new URL(database);
  // Require the established isolated test database as well as the lab declaration.
  // A lab flag alone must never turn this command into a production operator tool.
  if(!['postgres:','postgresql:'].includes(url.protocol)||decodeURIComponent(url.pathname)!=='/inveos_test'||!/^(restored_|quarantine_|test_)/.test(process.env.INVEOS_WORKER_SCHEMA??''))throw new Error('Isolated non-production recovery database/schema required');
  const pool=createPool(database,process.env.INVEOS_WORKER_SCHEMA,2);
  try{const receipt=await quarantineRestoredCase(pool,q);process.stdout.write(JSON.stringify(receipt)+'\n');if(receipt.moreRemaining){process.stderr.write('Quarantine remains closed; retirement is incomplete. Keep writers stopped. Continue the same request with nextBatch from this receipt.\n');process.exitCode=2;}}finally{await pool.end();}
  return;
 }
 const [flag,tenantId='',caseId='',actorId='',reason='',...extra]=args;
 if(flag!=='--confirm-quiesced'||extra.length||process.env.INVEOS_DEV_LAB!=='1'||process.env.NODE_ENV==='production')throw new Error('Explicit lab recovery only');
 const database=process.env.INVEOS_DATABASE_URL??'';if(!/^postgres(ql)?:\/\//.test(database))throw new Error('Database configuration');
 const pool=createPool(database,process.env.INVEOS_WORKER_SCHEMA??'inveos',2);
 try{process.stdout.write(JSON.stringify(await retireRestoredJobs(pool,{tenantId,caseId,actorId,reason,quiesced:true}))+'\n');}finally{await pool.end();}
}
main().catch(()=>{process.stderr.write('Recovery failed. Keep writers stopped and inspect scoped audit/job history before retrying.\n');process.exitCode=1;});
