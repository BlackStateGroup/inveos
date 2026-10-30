import {constants} from 'node:fs';
import {chmod,lstat,mkdir,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';
import type {Pool} from 'pg';
import type {OriginalStore} from './original-encryption.js';
import {readOriginalBounded} from './storage.js';
import {claimIntegrityJob,renewIntegrityJob,finishSpeechJob,finishIntegrityJob} from './integrity-jobs.js';
import {speechKind,speechProfile,speechProfileDigest} from './speech-derivative.js';
import {validateNativeQualification} from './native-document-worker.js';
import {runResearchContainer} from './container-worker.js';
import {WorkerStopped} from './leased-worker.js';
import {sha256} from './text-derivative.js';
import {inspectPcm} from '@inveos/contracts';
type Scope={tenantId:string;caseId:string;jobId:string};
const profile=JSON.parse(speechProfile);
async function lockedFile(path:string,bytes:number,digest:string){
 for(let p=path;;p=dirname(p)){if((await lstat(p)).isSymbolicLink())throw new WorkerStopped('runtime_drift');if(dirname(p)===p)break;}
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await file.stat();if(!info.isFile()||info.size!==bytes)throw new WorkerStopped('runtime_drift');const data=await file.readFile();if(data.length!==bytes||sha256(data)!==digest)throw new WorkerStopped('runtime_drift');return data;}finally{await file.close();}
}
const script=`export HOME=/scratch TMPDIR=/scratch PYTHONDONTWRITEBYTECODE=1
unset LD_PRELOAD LD_LIBRARY_PATH PYTHONPATH
exec python3 -I - <<'PYCODE'
import hashlib,json,os,pathlib
lock=pathlib.Path('/original/runtime-lock.json').read_bytes()
assert hashlib.sha256(lock).hexdigest()=='${profile.runtimeLock}'
for item in json.loads(lock)['files']:
 p=pathlib.Path(item['path']);assert p.stat().st_size==item['bytes']
 assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
p=pathlib.Path('/original/model.bin');assert p.stat().st_size==${profile.modelBytes}
assert hashlib.sha256(p.read_bytes()).hexdigest()=='${profile.modelSha256}'
os.execv('/opt/inveos/inveos-whisper',['inveos-whisper','/original/model.bin','/original/audio.wav'])
PYCODE`;

/** Explicit lab worker; never downloads a model, builds an image or discovers cases. */
export async function runSpeechJob(pool:Pool,store:OriginalStore,scope:Scope,options:{researchOnly:true;repositoryRoot:string;qualification:unknown;signal?:AbortSignal}){
 if(options.researchOnly!==true||!isAbsolute(options.repositoryRoot))throw new WorkerStopped('configuration');
 validateNativeQualification(options.qualification,true);
 const q=options.qualification as {imageId:string;runtimeLock?:string};
 if(q.runtimeLock!==profile.runtimeLock)throw new WorkerStopped('host_not_qualified');
 if((await pool.query('SELECT kind FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[scope.tenantId,scope.caseId,scope.jobId])).rows[0]?.kind!==speechKind)return null;
 if(options.signal?.aborted)throw new WorkerStopped('aborted');
 const lease=await claimIntegrityJob(pool,scope);if(!lease)return null;
 const renew=async()=>Boolean(await renewIntegrityJob(pool,scope,lease.token));let bundle:string|undefined;
 try{
  const source=(await pool.query(`SELECT e.object_path,e.byte_length,e.original_kind,j.authority_version FROM evidence e JOIN integrity_jobs j ON j.tenant_id=e.tenant_id AND j.case_id=e.case_id AND j.evidence_id=e.id WHERE j.tenant_id=$1 AND j.case_id=$2 AND j.id=$3`,[scope.tenantId,scope.caseId,scope.jobId])).rows[0];
  let original:Buffer;
  try{original=await readOriginalBounded(store,source.object_path,262144);if(source.original_kind!=='opaque_binary'||source.byte_length!==original.length||sha256(original)!==lease.digest)throw new Error('Original changed');}catch{return await finishIntegrityJob(pool,scope,lease.token,'original_unavailable');}
  try{inspectPcm(original);}catch{return await finishIntegrityJob(pool,scope,lease.token,'unsupported_media');}
  const model=await lockedFile(join(options.repositoryRoot,'.research-cache/whisper-inputs/ggml-tiny.en.bin'),profile.modelBytes,profile.modelSha256);
  const lockPath=join(options.repositoryRoot,'research/runtime_artifacts/whisper-runtime.lock.json'),info=await lstat(lockPath);
  if(info.size>16384)throw new WorkerStopped('runtime_drift');const lock=await lockedFile(lockPath,info.size,profile.runtimeLock);
  const cache=join(options.repositoryRoot,'.research-cache');await mkdir(cache,{recursive:true,mode:0o700});bundle=await mkdtemp(join(cache,'leased-speech-'));await chmod(bundle,0o755);
  await writeFile(join(bundle,'audio.wav'),original,{flag:'wx',mode:0o444});await writeFile(join(bundle,'model.bin'),model,{flag:'wx',mode:0o444});await writeFile(join(bundle,'runtime-lock.json'),lock,{flag:'wx',mode:0o444});
  const raw=await runResearchContainer({bundle,imageId:q.imageId,script,signal:options.signal,outputLimit:262144,containerSeconds:profile.containerSeconds},renew);
  // The container has been removed. Re-read the preserved original and fence the
  // lease/current authority again in the same transaction as derivative storage.
  return await finishSpeechJob(pool,store,scope,lease.token,{context:{...scope,evidenceId:lease.evidenceId,sourceDigest:lease.digest,authorityVersion:source.authority_version},profileDigest:speechProfileDigest,successful:true,raw});
 }catch(error){
  if(error instanceof WorkerStopped&&['lease_lost','renewal_failed','renewal_timeout','aborted'].includes(error.code))throw error;
  const result=await finishIntegrityJob(pool,scope,lease.token,error instanceof WorkerStopped&&error.code==='container_cleanup_unconfirmed'?'worker_cleanup_unconfirmed':'worker_execution_failed');
  if(error instanceof WorkerStopped&&error.code==='container_cleanup_unconfirmed')throw error;return result;
 }finally{if(bundle)await rm(bundle,{recursive:true,force:true});}
}
