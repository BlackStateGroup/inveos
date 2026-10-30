/** Explicit research-only execution using existing locked artifacts and actual host probes. */
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import type {Pool} from 'pg';
import type {OriginalStore} from './original-encryption.js';
import {readOriginalBounded} from './storage.js';
import {sha256} from './text-derivative.js';
import {claimIntegrityJob,renewIntegrityJob,finishIntegrityJob,finishTikaJob,validateDispatch} from './integrity-jobs.js';
import {superviseWorker,WorkerStopped} from './leased-worker.js';
import {runResearchContainer} from './container-worker.js';
import {tikaKind,tikaProfile,tikaProfileDigest} from './tika-derivative.js';
type Scope={tenantId:string;caseId:string;jobId:string};
type Options={researchOnly:true;repositoryRoot:string;qualification:unknown;signal?:AbortSignal};
export function validateTikaQualification(value:unknown){
 const q=value as {status?:string;checkedAt?:string;profile?:string;imageId?:string;repoDigests?:string[];checks?:string[];daemonLogging?:boolean;runtimeLockSha256?:string;parserExecuted?:boolean;resourceEvidence?:{oomKilled?:boolean;pids?:number;cpu?:number}}|null,p=JSON.parse(tikaProfile),age=Date.now()-Date.parse(q?.checkedAt??'');
 if(!q||!Number.isFinite(age)||age<0||age>900000||q.status!=='host_probe_passed'||q.profile!=='runtime-1g'||q.imageId!==p.imageId||q.runtimeLockSha256!==p.runtimeLockSha256||q.parserExecuted!==false||q.daemonLogging!==false||!Array.isArray(q.repoDigests)||!q.repoDigests.includes(p.image)||!Array.isArray(q.checks)||!['boundaries','timeout','stdout_limit','stderr_limit','memory','pids','cpu'].every(k=>q.checks!.includes(k))||q.resourceEvidence?.oomKilled!==true||!(Number(q.resourceEvidence?.pids)>0)||!(Number(q.resourceEvidence?.cpu)>0))throw new WorkerStopped('host_not_qualified');
}
const script="export TMPDIR=/scratch\nexec java -XX:ActiveProcessorCount=1 -XX:+UseSerialGC -Xmx256m -XX:MaxMetaspaceSize=128m -Djava.io.tmpdir=/scratch -Duser.home=/scratch -Djava.awt.headless=true -cp '/original/reduced-tika.jar:/original/artifacts/*' inveos.research.TikaPdfProbe /original/input.pdf";
export async function runTikaJob(pool:Pool,storage:OriginalStore,scope:Scope,options:Options){
 if(options.researchOnly!==true||!isAbsolute(options.repositoryRoot))throw new WorkerStopped('configuration');validateTikaQualification(options.qualification);
 const row=(await pool.query('SELECT kind FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[scope.tenantId,scope.caseId,scope.jobId])).rows[0];if(row?.kind!==tikaKind)return null;
 if(options.signal?.aborted)throw new WorkerStopped('aborted');const lease=await claimIntegrityJob(pool,scope);if(!lease)return null;
 const renew=async()=>Boolean(await renewIntegrityJob(pool,scope,lease.token));let bundle:string|undefined,phase:'prepare'|'parse'='prepare';
 try{
  const source=(await pool.query('SELECT e.*,j.authority_version AS job_authority FROM evidence e JOIN integrity_jobs j ON j.tenant_id=e.tenant_id AND j.case_id=e.case_id AND j.evidence_id=e.id WHERE j.tenant_id=$1 AND j.case_id=$2 AND j.id=$3',[scope.tenantId,scope.caseId,scope.jobId])).rows[0];let original:Buffer;
  try{original=await readOriginalBounded(storage,source.object_path,2097152);if(source.original_kind!=='opaque_binary'||original.length!==source.byte_length||sha256(original)!==lease.digest)throw new Error();}catch{return await finishIntegrityJob(pool,scope,lease.token,'original_unavailable');}
  if(original.length<8||!original.subarray(0,5).equals(Buffer.from('%PDF-')))return await finishIntegrityJob(pool,scope,lease.token,'unsupported_media');
  const cache=join(options.repositoryRoot,'.research-cache');await mkdir(cache,{recursive:true,mode:0o700});bundle=await mkdtemp(join(cache,'leased-tika-'));
  const prepared=await superviseWorker({command:'/usr/bin/python3',args:[join(options.repositoryRoot,'tools/prepare_tika_worker.py'),'--bundle',bundle],cwd:options.repositoryRoot,signal:options.signal,timeoutMs:90000,outputLimit:16384},renew);
  const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(prepared)),profile=JSON.parse(tikaProfile);
  if(receipt.status!=='verified_locked_tika_bundle'||receipt.compiledJarSha256!==profile.compiledJarSha256||receipt.runtimeLockSha256!==profile.runtimeLockSha256||receipt.wrapperSha256!==profile.wrapperSha256||receipt.sourceRevision!==profile.sourceRevision||receipt.parserExecuted!==false)throw new WorkerStopped('runtime_drift');
  await writeFile(join(bundle,'input.pdf'),original,{flag:'wx',mode:0o444});
  phase='parse';const raw=await runResearchContainer({bundle,imageId:profile.imageId,script,signal:options.signal,outputLimit:1048576,timeoutMs:90000,containerSeconds:100},renew);
  if(options.signal?.aborted)throw new WorkerStopped('aborted');
  return await finishTikaJob(pool,storage,scope,lease.token,{context:{...scope,evidenceId:lease.evidenceId,sourceDigest:lease.digest,authorityVersion:source.job_authority},profileDigest:tikaProfileDigest,raw,runtime:{qualification:options.qualification as Record<string,unknown>,preparation:receipt}});
 }catch(error){
  if(error instanceof WorkerStopped&&['lease_lost','renewal_failed','renewal_timeout'].includes(error.code))throw error;
  const code=error instanceof WorkerStopped?error.code:'';
  const failure=code==='container_cleanup_unconfirmed'?'worker_cleanup_unconfirmed':code==='aborted'?'worker_aborted':code==='timeout'?'worker_timeout':code==='output_limit'?'worker_output_limit':phase==='prepare'?'tika_runtime_unavailable':'tika_parser_rejected_or_failed';
  const result=await finishIntegrityJob(pool,scope,lease.token,failure);
  if(error instanceof WorkerStopped&&error.code==='container_cleanup_unconfirmed')throw error;return result;
 }finally{if(bundle)await rm(bundle,{recursive:true,force:true});}
}
/** Bounded tenant/case pass. No global discovery, background loop or automatic retry. */
export async function dispatchTikaJobs(pool:Pool,storage:OriginalStore,scope:Omit<Scope,'jobId'>,options:Options,limit=5){
 validateDispatch(scope,limit);if(limit>5)throw new WorkerStopped('configuration');const results=[];
 const queued=(await pool.query("SELECT id FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND kind=$3 AND status='queued' ORDER BY created_at,id LIMIT $4",[scope.tenantId,scope.caseId,tikaKind,limit])).rows;
 for(const row of queued){if(options.signal?.aborted)break;const result=await runTikaJob(pool,storage,{...scope,jobId:row.id},options);results.push({jobId:row.id,status:result?.status??'not_claimed',failureCode:result?.failureCode??null});}return {results,selected:queued.length};
}
