/** First-party process supervision, NOT a parser sandbox or an HTTP command API. */
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Pool } from 'pg';
import { renewIntegrityJob } from './integrity-jobs.js';

type Options = {command:string;args:string[];cwd:string;timeoutMs?:number;outputLimit?:number;
  heartbeatMs?:number;renewalTimeoutMs?:number;signal?:AbortSignal};
export class WorkerStopped extends Error {
  constructor(public readonly code:string){super(`Worker stopped: ${code}`);}
}

/** The supplied executable/arguments are trusted configuration, never evidence input. */
export async function superviseWorker(options:Options, renew:()=>Promise<boolean>):Promise<Buffer> {
  const {command,args,cwd,signal,timeoutMs=120000,outputLimit=1048576,heartbeatMs=20000,renewalTimeoutMs=5000}=options;
  if(process.platform!=='linux' || !isAbsolute(command) || !isAbsolute(cwd) ||
    !Array.isArray(args) || args.some(a=>typeof a!=='string') ||
    !Number.isInteger(timeoutMs) || timeoutMs<10 || timeoutMs>240000 ||
    !Number.isInteger(outputLimit) || outputLimit<1 || outputLimit>1048576 ||
    !Number.isInteger(heartbeatMs) || heartbeatMs<10 || heartbeatMs>20000 ||
    !Number.isInteger(renewalTimeoutMs) || renewalTimeoutMs<10 || renewalTimeoutMs>5000)throw new WorkerStopped('configuration');
  async function check() {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const allowed=await Promise.race([Promise.resolve().then(renew),new Promise<boolean>((_,reject)=>{
        timer=setTimeout(()=>reject(new WorkerStopped('renewal_timeout')),renewalTimeoutMs);
      })]);
      if(!allowed)throw new WorkerStopped('lease_lost');
    } catch(error) {throw error instanceof WorkerStopped?error:new WorkerStopped('renewal_failed');}
    finally {clearTimeout(timer);}
  }
  if(signal?.aborted)throw new WorkerStopped('aborted');
  await check(); // Never spawn without a current lease.
  if(signal?.aborted)throw new WorkerStopped('aborted');
  return new Promise<Buffer>((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env:{LANG:'C.UTF-8'},shell:false,detached:true,stdio:['ignore','pipe','pipe']});
    let finished=false,closed=false,failure:WorkerStopped|undefined,total=0;
    const chunks:Buffer[]=[];
    let heartbeat:ReturnType<typeof setTimeout>|undefined;
    let active:Promise<void>|undefined;
    function killGroup(){if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')child.kill('SIGKILL');}}}
    function finish(){
      if(finished)return;finished=true;clearTimeout(wall);clearTimeout(heartbeat);signal?.removeEventListener('abort',abort);
      killGroup();
      if(failure)reject(failure);else resolve(Buffer.concat(chunks));
    }
    function stop(code:string){if(finished)return;failure??=new WorkerStopped(code);clearTimeout(heartbeat);killGroup();if(closed)finish();}
    const abort=()=>stop('aborted');signal?.addEventListener('abort',abort,{once:true});
    const wall=setTimeout(()=>stop('timeout'),timeoutMs);
    if(signal?.aborted)stop('aborted');
    function schedule(){heartbeat=setTimeout(()=>{
      if(finished||closed)return;
      active=check().then(()=>{if(!finished&&!closed&&!failure)schedule();},error=>stop((error as WorkerStopped).code));
    },heartbeatMs);}
    schedule();
    function collect(chunk:Buffer,keep:boolean){
      if(finished||failure)return;
      total+=chunk.length;
      if(total>outputLimit){stop('output_limit');return;}
      if(keep)chunks.push(chunk);
    }
    child.stdout.on('data',(chunk:Buffer)=>collect(chunk,true));
    child.stderr.on('data',(chunk:Buffer)=>collect(chunk,false));
    child.on('error',()=>stop('spawn_failed'));
    child.on('exit',()=>killGroup()); // Includes descendants retaining inherited pipes.
    child.on('close',async code=>{
      closed=true;clearTimeout(heartbeat);
      if(code!==0)failure??=new WorkerStopped('exit_failed');
      if(failure){finish();return;}
      await active;
      if(finished)return;
      try{await check();}catch(error){failure??=error as WorkerStopped;}
      finish(); // Output is still untrusted; caller must verify and commit with token fencing.
    });
  });
}

export function runLeasedWorker(pool:Pool,scope:{tenantId:string;caseId:string;jobId:string},token:string,options:Options) {
  return superviseWorker(options,async()=>Boolean(await renewIntegrityJob(pool,scope,token)));
}
