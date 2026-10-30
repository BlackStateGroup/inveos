/** Explicit fictional-development CLI. Never downloads, builds or approves the runtime. */
import {readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {isAbsolute,join} from 'node:path';
import {createPool} from './db.js';
import {originalStoreFromEnv} from './original-encryption.js';
import {runTikaJob,dispatchTikaJobs} from './tika-worker.js';
import {WorkerStopped} from './leased-worker.js';
async function main(){
 const [tenantId,caseId,jobId,...extra]=process.argv.slice(2),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,database=process.env.INVEOS_DATABASE_URL,root=process.env.INVEOS_STORAGE_ROOT;
 if(process.env.INVEOS_DEV_LAB!=='1'||process.env.INVEOS_RESEARCH_TIKA!=='1'||process.env.NODE_ENV==='production'||!database||!/^postgres(?:ql)?:\/\//.test(database)||!root||!isAbsolute(root)||!tenantId||!caseId||!jobId||extra.length||![tenantId,caseId].every(v=>uuid.test(v))||jobId!=='--dispatch-five'&&!uuid.test(jobId))throw new Error('Explicit fictional lab, restricted database/store and scoped UUIDs required');
 const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url)),path=join(repositoryRoot,'.research-cache/tika-worker-qualification.json'),stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>16384)throw new Error('Qualification receipt bound');
 const qualification=JSON.parse(await readFile(path,'utf8')),pool=createPool(database,process.env.INVEOS_WORKER_SCHEMA??'inveos',2),controller=new AbortController(),stop=()=>controller.abort();
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{const options={researchOnly:true as const,repositoryRoot,qualification,signal:controller.signal},store=originalStoreFromEnv(root),result=jobId==='--dispatch-five'?await dispatchTikaJobs(pool,store,{tenantId,caseId},options):await runTikaJob(pool,store,{tenantId,caseId,jobId},options);process.stdout.write(JSON.stringify({result,scope:{tenantId,caseId},researchOnly:true,productionApproved:false})+'\n');if(result&&('status' in result?result.status==='failed':'results' in result&&result.results.some(r=>r.status==='failed')))process.exitCode=1;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await pool.end();}
}
main().catch(e=>{process.stderr.write(JSON.stringify({status:'failed',failureCode:e instanceof WorkerStopped?e.code:'configuration_or_worker_failure'})+'\n');process.exitCode=1;});
