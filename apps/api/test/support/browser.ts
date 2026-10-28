import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export async function eventually(check:()=>Promise<boolean>,label:string,timeout=15000){
 const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(100);}throw new Error('Timed out: '+label);
}
/** First-party CDP harness; uses the host browser with its sandbox enabled. */
export async function launchBrowser(){
 const root=await mkdtemp(join(tmpdir(),'inveos-browser-'));
 const child=spawn(process.env.INVEOS_CHROME_PATH||'/usr/bin/google-chrome',['--headless=new','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+root,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let diagnostic='',failure:Error|undefined;child.stderr.on('data',b=>{diagnostic=(diagnostic+String(b)).slice(-3000);});child.on('error',e=>{failure=e;});
 let socket:WebSocket|undefined;
 const close=async()=>{socket?.close();if(child.pid&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise<void>(r=>child.once('exit',()=>r())),delay(2000)]);if(child.pid&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise<void>(r=>child.once('exit',()=>r()));}}await rm(root,{recursive:true,force:true});};
 try{
  let port='';await eventually(async()=>{if(failure)throw failure;if(child.exitCode!==null)throw new Error('Sandboxed Chrome exited: '+diagnostic);try{port=(await readFile(join(root,'DevToolsActivePort'),'utf8')).split('\n')[0]!;return /^\d+$/.test(port);}catch{return false;}},'sandboxed Chrome startup');
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json() as {type:string;webSocketDebuggerUrl:string}[];
  const target=targets.find(t=>t.type==='page');if(!target)throw new Error('No Chrome page target');socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve,reject)=>{socket!.addEventListener('open',()=>resolve(),{once:true});socket!.addEventListener('error',()=>reject(new Error('CDP connection failed')),{once:true});});
  let id=0;const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);if(message.error)waiter.reject(new Error('CDP: '+message.error.message));else waiter.resolve(message.result);});
  const send=<T=Record<string,unknown>>(method:string,params:object={}):Promise<T>=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timeout: '+method));},10000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v as T);},reject:e=>{clearTimeout(timer);reject(e);}});socket!.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async<T=unknown>(expression:string):Promise<T>=>{const result=await send<{result:{value:T};exceptionDetails?:unknown}>('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error('Browser evaluation failed: '+JSON.stringify(result.exceptionDetails));return result.result.value;};
  return {send,evaluate,close,root};
 }catch(error){await close();throw error;}
}
