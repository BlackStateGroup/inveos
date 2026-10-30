/** Explicit lab-only single-job entry; no case discovery or model downloads. */
import {readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {isAbsolute,join} from 'node:path';
import {createPool} from './db.js';
import {originalStoreFromEnv} from './original-encryption.js';
import {runSpeechJob} from './speech-worker.js';
import {WorkerStopped} from './leased-worker.js';
const [tenantId,caseId,jobId,...extra]=process.argv.slice(2),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const database=process.env.INVEOS_DATABASE_URL,root=process.env.INVEOS_STORAGE_ROOT;
if(process.env.INVEOS_DEV_LAB!=='1'||process.env.INVEOS_SPEECH_LAB!=='1'||process.env.NODE_ENV==='production'||!tenantId||!caseId||!jobId||extra.length||![tenantId,caseId,jobId].every(x=>uuid.test(x))||!database?.startsWith('postgres')||!root||!isAbsolute(root))throw new Error('Explicit speech lab, database/storage and tenant/case/job UUIDs required.');
const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url)),path=join(repositoryRoot,'.research-cache/speech-worker-qualification.json'),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw new Error('Invalid speech qualification receipt');
const qualification=JSON.parse(await readFile(path,'utf8')),pool=createPool(database),controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{const r=await runSpeechJob(pool,originalStoreFromEnv(root),{tenantId,caseId,jobId},{researchOnly:true,repositoryRoot,qualification,signal:controller.signal});process.stdout.write(JSON.stringify({jobId,status:r?.status??'not_claimed',failureCode:r?.failureCode??null})+'\n');if(r?.status==='failed')process.exitCode=1;}catch(e){process.stderr.write(JSON.stringify({jobId,error:e instanceof WorkerStopped?e.code:'speech_worker_failed'})+'\n');process.exitCode=1;}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await pool.end();}
