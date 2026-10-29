import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import Fastify from 'fastify';
import {forwardBrowserApi} from './support/browser-proxy.js';

test('browser proxy preserves complete HTTP bodies and origin headers without rewriting them',{timeout:5000},async()=>{
 const api=Fastify();api.post('/echo',async req=>({body:req.body,origin:req.headers.origin}));const address=await api.listen({host:'127.0.0.1',port:0});
 const proxy=createServer((req,res)=>{forwardBrowserApi(req,res,address+req.url);});await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+(proxy.address() as {port:number}).port+'/echo',{method:'POST',headers:{'content-type':'application/json',origin:'http://fictional.invalid'},body:JSON.stringify({text:'Fictional complete request'})});assert.equal(response.status,200);assert.deepEqual(await response.json(),{body:{text:'Fictional complete request'},origin:'http://fictional.invalid'});}
 finally{proxy.closeAllConnections();await api.close();await new Promise<void>(r=>proxy.close(()=>r()));}
});

test('browser disconnect aborts a partial forwarded upload and lets the actual API shut down',{timeout:5000},async()=>{
 const api=Fastify();api.post('/partial',async()=>({ok:true}));const address=await api.listen({host:'127.0.0.1',port:0});
 let received!:()=>void,aborted=false;const accepted=new Promise<void>(r=>{received=r;});api.server.on('request',req=>{req.once('aborted',()=>{aborted=true;});received();});
 let upstream:ReturnType<typeof forwardBrowserApi>|undefined;
 const proxy=createServer((req,res)=>{upstream=forwardBrowserApi(req,res,address+req.url);});await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 const client=request('http://127.0.0.1:'+(proxy.address() as {port:number}).port+'/partial',{method:'POST',headers:{'content-type':'application/json','content-length':'100'}});client.on('error',()=>{});
 try{
  client.write('{');await accepted;client.destroy();
  const deadline=Date.now()+1500;while(!aborted&&Date.now()<deadline)await delay(10);
  assert.equal(aborted,true,'The API must see the interrupted body, rather than wait indefinitely.');assert.equal(upstream?.destroyed,true);
  let closed=false;const closing=api.close().then(()=>{closed=true;});await Promise.race([closing,delay(1000)]);assert.equal(closed,true,'Disconnected test traffic must not stall Fastify shutdown.');
 }finally{client.destroy();upstream?.destroy();proxy.closeAllConnections();api.server.closeAllConnections();await api.close();await new Promise<void>(r=>proxy.close(()=>r()));}
});
