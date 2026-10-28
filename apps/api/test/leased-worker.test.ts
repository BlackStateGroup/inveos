import assert from 'node:assert/strict';
import { test } from 'node:test';
import { superviseWorker } from '../src/leased-worker.js';
const opts=(script:string)=>({command:process.execPath,args:['-e',script],cwd:process.cwd(),heartbeatMs:20,renewalTimeoutMs:200,timeoutMs:1500,outputLimit:1024});

test('worker returns bounded bytes, strips inherited environment and checks lease at completion',async()=>{
  let renewals=0;process.env.INVEOS_FICTIONAL_SECRET='must-not-reach-worker';
  try {
    const out=await superviseWorker(opts('setTimeout(()=>process.stdout.write(process.env.INVEOS_FICTIONAL_SECRET || "FICTIONAL"),100)'),async()=>{renewals++;return true;});
    assert.equal(out.toString(),'FICTIONAL');assert.ok(renewals>=3);
  }finally{delete process.env.INVEOS_FICTIONAL_SECRET;}
});
test('worker denies invalid configuration, absent lease and aborted start',async()=>{
  let calls=0;const renew=async()=>{calls++;return false;};
  await assert.rejects(superviseWorker({...opts(''),command:'relative'},renew),/configuration/);assert.equal(calls,0);
  await assert.rejects(superviseWorker(opts('process.exit(99)'),renew),/lease_lost/);
  const signal=AbortSignal.abort();await assert.rejects(superviseWorker({...opts(''),signal},renew),/aborted/);assert.equal(calls,1);
});
test('worker kills running process on lost lease, rejected renewal, stalled renewal and abort',async()=>{
  const controller=new AbortController();
  const aborted=superviseWorker({...opts('setInterval(()=>{},1000)'),signal:controller.signal},async()=>true);
  const timer=setTimeout(()=>controller.abort(),50);
  try{await assert.rejects(aborted,/aborted/);}finally{clearTimeout(timer);}
  for(const mode of ['lost','error','stall']) {
    let calls=0;
    await assert.rejects(superviseWorker({...opts('setInterval(()=>{},1000)'),renewalTimeoutMs:30},async()=>{
      if(++calls===1)return true;
      if(mode==='error')throw new Error('FICTIONAL secret detail');
      if(mode==='stall')return new Promise<boolean>(()=>{});
      return false;
    }),new RegExp(mode==='lost'?'lease_lost':mode==='error'?'renewal_failed':'renewal_timeout'));
  }
});
test('worker bounds combined output, timeout and nonzero exits without leaking stderr',async()=>{
  for(const script of ['process.stdout.write("x".repeat(2048))','process.stderr.write("SECRET".repeat(400))']) {
    await assert.rejects(superviseWorker(opts(script),async()=>true),/output_limit/);
  }
  await assert.rejects(superviseWorker({...opts('setInterval(()=>{},1000)'),timeoutMs:100},async()=>true),/timeout/);
  await assert.rejects(superviseWorker(opts('process.stderr.write("SECRET");process.exit(2)'),async()=>true),/exit_failed/);
});
test('worker denies completion after a final lease check and handles spawn failure',async()=>{
  let calls=0;
  await assert.rejects(superviseWorker({...opts('process.stdout.write("FICTIONAL")'),heartbeatMs:20000},async()=>++calls===1),/lease_lost/);
  await assert.rejects(superviseWorker({...opts(''),command:'/nonexistent-inveos-fictional-worker'},async()=>true),/spawn_failed/);
});
test('worker removes a child holding inherited pipes after the parent exits',async()=>{
  const script='require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});setTimeout(()=>process.exit(0),50)';
  assert.equal((await superviseWorker(opts(script),async()=>true)).length,0);
});
