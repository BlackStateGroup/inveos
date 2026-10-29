/** Explicit, bounded lab recovery command. Does not restore data or start workers. */
import {createPool} from './db.js';
import {retireRestoredJobs} from './recover-jobs.js';
async function main(){
 const [flag,tenantId='',caseId='',actorId='',reason='',...extra]=process.argv.slice(2);
 if(flag!=='--confirm-quiesced'||extra.length||process.env.INVEOS_DEV_LAB!=='1'||process.env.NODE_ENV==='production')throw new Error('Explicit lab recovery only');
 const database=process.env.INVEOS_DATABASE_URL??'';if(!/^postgres(ql)?:\/\//.test(database))throw new Error('Database configuration');
 const pool=createPool(database,process.env.INVEOS_WORKER_SCHEMA??'inveos',2);
 try{process.stdout.write(JSON.stringify(await retireRestoredJobs(pool,{tenantId,caseId,actorId,reason,quiesced:true}))+'\n');}finally{await pool.end();}
}
main().catch(()=>{process.stderr.write('Recovery failed. Keep writers stopped and inspect scoped audit/job history before retrying.\n');process.exitCode=1;});
