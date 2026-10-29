/** Opt-in research orchestration, not an approved production parser service. */
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import type {Pool} from 'pg';
import {claimIntegrityJob,renewIntegrityJob,finishDocumentJob,finishRasterJob,finishIntegrityJob} from './integrity-jobs.js';
import {documentKind,documentProfile,documentProfileDigest} from './document-derivative.js';
import {readOriginalBounded} from './storage.js';
import {sha256} from './text-derivative.js';
import {superviseWorker,WorkerStopped} from './leased-worker.js';
import {runResearchContainer} from './container-worker.js';

import {rasterProfileDigest} from './raster-derivative.js';
type Scope={tenantId:string;caseId:string;jobId:string};
export function validateNativeQualification(value:unknown){
  const q=value as {status?:string;checkedAt?:string;profile?:string;imageId?:string;repoDigests?:string[];checks?:string[];daemonLogging?:boolean;resourceEvidence?:{oomKilled?:boolean;pids?:number;cpu?:number}}|null;
  const profile=JSON.parse(documentProfile);
  const age=Date.now()-Date.parse(q?.checkedAt??'');
  if(!Number.isFinite(age)||age<0||age>15*60*1000)throw new WorkerStopped('host_not_qualified');
  if(!q||q.status!=='host_probe_passed'||q.profile!=='runtime-1g'||q.imageId!=='sha256:'+profile.imageId||q.daemonLogging!==false
    ||!Array.isArray(q.repoDigests)||!q.repoDigests.includes(profile.image)||!Array.isArray(q.checks)
    ||!['boundaries','timeout','stdout_limit','stderr_limit','memory','pids','cpu'].every(c=>q.checks!.includes(c))
    ||q.resourceEvidence?.oomKilled!==true||!(Number(q.resourceEvidence?.pids)>0)||!(Number(q.resourceEvidence?.cpu)>0))throw new WorkerStopped('host_not_qualified');
}
const script=`export HOME=/scratch TMPDIR=/scratch PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
export PYTHONPATH=/original/source:/original/runtime
exec python /original/run.py`;

type Options={researchOnly:true;repositoryRoot:string;qualification:unknown;signal?:AbortSignal};
export function runNativeDocumentJob(pool:Pool,storageRoot:string,scope:Scope,options:Options){return runNativeJob(pool,storageRoot,scope,options,'document');}
export function runRasterDocumentJob(pool:Pool,storageRoot:string,scope:Scope,options:Options){return runNativeJob(pool,storageRoot,scope,options,'raster');}
async function runNativeJob(pool:Pool,storageRoot:string,scope:Scope,options:Options,kind:'document'|'raster'){
  if(options.researchOnly!==true||!isAbsolute(options.repositoryRoot))throw new WorkerStopped('configuration');
  validateNativeQualification(options.qualification);
  const row=(await pool.query('SELECT kind FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[scope.tenantId,scope.caseId,scope.jobId])).rows[0];
  if(row?.kind!==(kind==='document'?documentKind:'pdf_raster_lab_v1'))return null;
  if(options.signal?.aborted)throw new WorkerStopped('aborted');
  const lease=await claimIntegrityJob(pool,scope);if(!lease)return null;
  const renew=async()=>Boolean(await renewIntegrityJob(pool,scope,lease.token));
  let bundle:string|undefined;
  try{
    const source=(await pool.query(`SELECT e.object_path,e.byte_length,e.original_kind,j.authority_version FROM evidence e
      JOIN integrity_jobs j ON j.tenant_id=e.tenant_id AND j.case_id=e.case_id AND j.evidence_id=e.id
      WHERE j.tenant_id=$1 AND j.case_id=$2 AND j.id=$3`,[scope.tenantId,scope.caseId,scope.jobId])).rows[0];
    let original:Buffer;
    try{original=await readOriginalBounded(storageRoot,source.object_path,65536);
      if(source.original_kind!=='opaque_binary'||original.length!==source.byte_length||sha256(original)!==lease.digest)throw new Error('Original mismatch');
    }catch{return await finishIntegrityJob(pool,scope,lease.token,'original_unavailable');}
    const cache=join(options.repositoryRoot,'.research-cache');await mkdir(cache,{recursive:true,mode:0o700});
    bundle=await mkdtemp(join(cache,'leased-document-'));
    // First-party verifier expands hash-locked wheels as data. It never imports them.
    await superviseWorker({command:'/usr/bin/python3',args:[join(options.repositoryRoot,'tools/prepare_document_worker.py'),'--bundle',bundle,'--kind',kind],cwd:options.repositoryRoot,signal:options.signal,timeoutMs:90000,outputLimit:16384},renew);
    await writeFile(join(bundle,'input.pdf'),original,{flag:'wx',mode:0o444});
    const output=await runResearchContainer({bundle,imageId:'sha256:'+JSON.parse(documentProfile).imageId,script,signal:options.signal},renew);
    const parsed=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(output));
    if(kind==='raster'){
      return await finishRasterJob(pool,storageRoot,scope,lease.token,{context:{...scope,evidenceId:lease.evidenceId,sourceDigest:lease.digest,authorityVersion:source.authority_version},profileDigest:rasterProfileDigest,originalSha256:parsed.originalSha256,pages:parsed.pages});
    }
    if(parsed.successful!==true||parsed.originalSha256!==lease.digest||!parsed.document)throw new WorkerStopped('document_output');
    // Cleanup is already confirmed before attachment. Bind authority from the job,
    // never from worker output. Attachment re-reads the original and fences again.
    return await finishDocumentJob(pool,storageRoot,scope,lease.token,{context:{...scope,evidenceId:lease.evidenceId,sourceDigest:lease.digest,authorityVersion:source.authority_version},profileDigest:documentProfileDigest,successful:true,raw:Buffer.from(JSON.stringify(parsed.document))});
  }catch(error){
    if(error instanceof WorkerStopped&&['lease_lost','renewal_failed','renewal_timeout','aborted'].includes(error.code))throw error;
    const receipt=await finishIntegrityJob(pool,scope,lease.token,error instanceof WorkerStopped&&error.code==='container_cleanup_unconfirmed'?'worker_cleanup_unconfirmed':'worker_execution_failed');
    if(error instanceof WorkerStopped&&error.code==='container_cleanup_unconfirmed')throw error;
    return receipt;
  }finally{if(bundle)await rm(bundle,{recursive:true,force:true});}
}
