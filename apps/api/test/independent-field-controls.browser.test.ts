/** Real component + HTTP/PostgreSQL regression; sandbox-enabled Chromium only. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'vite';
import {launchBrowser,eventually} from './support/browser.js';
import {forwardBrowserApi} from './support/browser-proxy.js';
import {workflowFixture,tenant,owner} from './support/workflow-fixture.js';

test('real browser Field controls fence scope selection during pending reads and clear denied grants',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:60000},async()=>{
 const browser=await launchBrowser();let f:Awaited<ReturnType<typeof workflowFixture>>|undefined,api='',entry='';const upstreams=new Set<ReturnType<typeof forwardBrowserApi>>();
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('../../web/',import.meta.url)),logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'fictional-independent-review-entry',resolveId:id=>id==='/review-entry.js'?'\0review-entry.js':undefined,load:id=>id==='\0review-entry.js'?entry:undefined,configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.startsWith('/api/')){const u=forwardBrowserApi(req,res,api+req.url);upstreams.add(u);u.once('close',()=>upstreams.delete(u));return;}if(req.url==='/independent-review.html'){res.setHeader('content-type','text/html');res.end('<div id="review"></div><script type="module" src="/review-entry.js"></script>');return;}next();});}}]});
 try{await server.listen();const origin=new URL(server.resolvedUrls!.local[0]!).origin;f=await workflowFixture(origin);api=await f.app.listen({host:'127.0.0.1',port:0});const fixture=f,deviceId=randomUUID();await f.must('/api/field/devices',{id:deviceId,label:'Fictional pending-scope device'});await f.must(f.base+'/field-grants/prepare',{deviceId});
  entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {FieldControls} from '/src/FieldControls.tsx';createRoot(document.getElementById('review')).render(React.createElement(FieldControls,${JSON.stringify({cases:[{id:f.caseId,ref:'FICTIONAL-REVIEW',title:'Fictional scoped case'}],csrf:f.maker['x-csrf-token'],reviewer:true})}));`;
  for(const part of f.maker.cookie.split('; ')){const i=part.indexOf('=');await browser.send('Network.setCookie',{name:part.slice(0,i),value:part.slice(i+1),url:origin,httpOnly:part.startsWith('inveos_session=')});}await browser.send('Page.navigate',{url:origin+'/independent-review.html'});
  async function click(label:string){await eventually(()=>browser.evaluate<boolean>(`[...document.querySelectorAll('button')].some(b=>b.textContent?.trim()===${JSON.stringify(label)}&&!b.disabled)`),'enabled '+label);const point=await browser.evaluate<{x:number;y:number}>(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});}
  await click('Agency device oversight');await eventually(()=>browser.evaluate<boolean>(`document.querySelectorAll('select').length===2`),'account and case controls');
  const lock=await f.admin.connect();await lock.query('BEGIN');await lock.query('SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,f.caseId]);
  try{await click('Inspect current case grants');let blocked=false;for(let i=0;i<70;i++){if((await f.admin.query('SELECT 1 FROM pg_locks WHERE NOT granted')).rowCount){blocked=true;break;}await delay(10);}assert.ok(blocked,'actual API read is pending');assert.deepEqual(await browser.evaluate<boolean[]>('[...document.querySelectorAll("select")].map(s=>s.disabled)'),[true,true],'scope must stay pinned until its response resolves');await lock.query('COMMIT');}finally{await lock.query('ROLLBACK');lock.release();}
  await eventually(()=>browser.evaluate<boolean>(`document.body.textContent.includes(${JSON.stringify(deviceId)})`),'exact grant shown');await fixture.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,fixture.caseId,owner]);await click('Inspect current case grants');await eventually(()=>browser.evaluate<boolean>(`!!document.querySelector('[role="alert"]')&&!document.body.textContent.includes(${JSON.stringify(deviceId)})`),'denial clears prior grant content');
 }finally{await browser.close();for(const u of upstreams)u.destroy();await server.close();await f?.close();}
});
