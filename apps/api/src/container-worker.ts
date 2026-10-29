/** Trusted research-worker lifecycle. No HTTP command endpoint, pulls or builds. */
import {randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {superviseWorker,WorkerStopped} from './leased-worker.js';

const scratch='rw,noexec,nosuid,nodev,size=512m,mode=1777';
const output='rw,noexec,nosuid,nodev,size=16m,mode=1777';
const docker='/usr/bin/docker';
const endpoint='--host=unix:///var/run/docker.sock';
type Settings={bundle:string;imageId:string;script:string;signal?:AbortSignal;timeoutMs?:number;heartbeatMs?:number;outputLimit?:number};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new WorkerStopped('container_configuration');return value as Record<string,unknown>;}
function require(condition:unknown){if(!condition)throw new WorkerStopped('container_configuration');}
export function validateContainer(info:unknown,bundle:string,imageId:string){
  const i=object(info),host=object(i.HostConfig),config=object(i.Config),tmpfs=object(host.Tmpfs);
  require(i.Image===imageId&&config.User==='65534:65534'&&host.NetworkMode==='none'&&host.ReadonlyRootfs===true&&host.Privileged===false);
  require(object(host.LogConfig).Type==='none'&&JSON.stringify(host.CapDrop)==='["ALL"]'&&Array.isArray(host.SecurityOpt)&&host.SecurityOpt.includes('no-new-privileges:true'));
  require(host.Memory===1073741824&&host.MemorySwap===1073741824&&host.NanoCpus===500000000&&host.PidsLimit===32);
  require(Object.keys(tmpfs).length===2&&tmpfs['/scratch']===scratch&&tmpfs['/output']===output);
  require(Array.isArray(i.Mounts));const mounts=i.Mounts as Record<string,unknown>[];
  require(mounts.length===1&&mounts[0]?.Type==='bind'&&mounts[0]?.Source===bundle&&mounts[0]?.Destination==='/original'&&mounts[0]?.RW===false);
  require(!config.Volumes||Object.keys(object(config.Volumes)).length===0);
  require(!host.Binds||Array.isArray(host.Binds)&&host.Binds.length===0);
  require(!host.CapAdd||Array.isArray(host.CapAdd)&&host.CapAdd.length===0);
  require(!host.Devices||Array.isArray(host.Devices)&&host.Devices.length===0);
  require(!host.PidMode&&!host.IpcMode?.toString().includes('host'));
}

/** Bundle and script are first-party trusted configuration, never request/evidence fields. */
export async function runResearchContainer(settings:Settings,renew:()=>Promise<boolean>):Promise<Buffer>{
  const {bundle,imageId,script,signal,timeoutMs=90000,heartbeatMs=20000,outputLimit=1048576}=settings;
  if(!isAbsolute(bundle)||bundle.includes(',')||!/^sha256:[a-f0-9]{64}$/.test(imageId)||typeof script!=='string'||script.length>8192)throw new WorkerStopped('configuration');
  const name='inveos-leased-'+randomUUID();
  const run=(args:string[],active=true,limit=1048576)=>superviseWorker({command:docker,args:[endpoint,...args],cwd:bundle,
    timeoutMs:active?timeoutMs:15000,outputLimit:limit,heartbeatMs,...(active?{signal}:{} )},active?renew:async()=>true);
  let result:Buffer|undefined,failure:unknown;
  try{
    // Reject image-declared volumes; the fixed runtime does not need writable image mounts.
    const image=JSON.parse((await run(['image','inspect',imageId])).toString())[0];
    require(image.Id===imageId&&(!image.Config.Volumes||Object.keys(image.Config.Volumes).length===0));
    await run(['create','--pull=never','--name',name,'--label','inveos.research-worker=true','--network=none','--log-driver=none',
      '--user=65534:65534','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--memory=1024m','--memory-swap=1024m','--cpus=0.5','--pids-limit=32',
      `--tmpfs=/scratch:${scratch}`,`--tmpfs=/output:${output}`,'--mount',`type=bind,src=${bundle},dst=/original,readonly`,'--entrypoint=/bin/bash',imageId,'-ceu',script]);
    const info=JSON.parse((await run(['inspect',name])).toString())[0];validateContainer(info,bundle,imageId);
    result=await run(['start','-a',name],true,outputLimit);
  }catch(error){failure=error;}
  finally{
    // Killing the Docker client does NOT stop the daemon-owned workload. Cleanup
    // ignores lost leases/abort signals and must succeed before output is returned.
    try{
      try{await run(['rm','-f','-v',name],false);}catch{/* Confirm daemon reachability and absence below. */}
      const remaining=await run(['container','ls','-aq','--filter',`name=^/${name}$`],false);
      if(remaining.toString().trim())throw new Error('Container remains');
    }catch{throw new WorkerStopped('container_cleanup_unconfirmed');}
  }
  if(failure)throw failure;
  if(!result)throw new WorkerStopped('container_failed');
  return result;
}
