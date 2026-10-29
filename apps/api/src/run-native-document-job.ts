import {originalStoreFromEnv} from './original-encryption.js';
/** Explicit single-job research CLI; never discovers cases or automatically dispatches. */
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {isAbsolute,join} from 'node:path';
import {createPool} from './db.js';
import {runNativeDocumentJob,runOcrDocumentJob} from './native-document-worker.js';
import {WorkerStopped} from './leased-worker.js';

const [tenantId,caseId,jobId,...extra]=process.argv.slice(2),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ocr=process.env.INVEOS_RESEARCH_OCR==='1';
const database=process.env.INVEOS_DATABASE_URL,storageRoot=process.env.INVEOS_STORAGE_ROOT;
if(process.env.INVEOS_DEV_LAB!=='1'||(!ocr&&process.env.INVEOS_RESEARCH_NATIVE!=='1')||process.env.NODE_ENV==='production'
  ||!tenantId||!caseId||!jobId||extra.length||![tenantId,caseId,jobId].every(v=>uuid.test(v))||!database?.startsWith('postgres')||!storageRoot||!isAbsolute(storageRoot))throw new Error('Explicit research lab, database/storage and three scoped UUIDs required');
const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url)),path=join(repositoryRoot,ocr?'.research-cache/tesseract-worker-qualification.json':'.research-cache/worker-qualification.json');
if((await stat(path)).size>16384)throw new Error('Qualification receipt limit');
const qualification=JSON.parse(await readFile(path,'utf8')),pool=createPool(database),controller=new AbortController();
const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
  const result=await (ocr?runOcrDocumentJob:runNativeDocumentJob)(pool,originalStoreFromEnv(storageRoot),{tenantId,caseId,jobId},{researchOnly:true,repositoryRoot,qualification,signal:controller.signal});
  process.stdout.write(JSON.stringify({jobId,status:result?.status??'not_claimed',failureCode:result?.failureCode??null})+'\n');
  if(result?.status==='failed')process.exitCode=1;
}catch(error){process.stderr.write(JSON.stringify({jobId,error:error instanceof WorkerStopped?error.code:'worker_failed'})+'\n');process.exitCode=1;}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await pool.end();}
