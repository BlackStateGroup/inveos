/** Real loopback API + restricted PostgreSQL + sandboxed host Chrome; no response mocks. */
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../../src/app.js';
import {sourceDatabase, hash} from './source-family.js';
import {forwardBrowserApi} from './browser-proxy.js';
import {eventually, launchBrowser} from './browser.js';

export type ResearchSession = {userId:string; cookie:string; csrf:string};
export type HostBrowser = Awaited<ReturnType<typeof launchBrowser>>;
export {hash, eventually, launchBrowser};

export async function researchBrowserFixture() {
 const db = await sourceDatabase();
 let app:Awaited<ReturnType<typeof createApp>>|undefined, apiAddress='';
 const upstreams = new Set<ReturnType<typeof forwardBrowserApi>>();
 const requests:Array<{method:string; path:string; status:number}> = [];
 const traps:string[] = [];
 const dist = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
 const server = createServer((req,res)=>{void(async()=>{
  const path = new URL(req.url!, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
   const u=forwardBrowserApi(req,res,apiAddress+req.url,status=>{requests.push({method:req.method!,path,status});return undefined;});
   upstreams.add(u);u.once('close',()=>upstreams.delete(u));return;
  }
  if(path==='/fictional-research-trap'){traps.push(path);res.statusCode=410;res.end();return;}
  if(path==='/'){res.setHeader('content-type','text/html');res.end(await readFile(join(dist,'index.html')));return;}
  if(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path)){
   res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(dist,path.slice(1))));return;
  }
  res.statusCode=404;res.end();
 })().catch(()=>{res.statusCode=500;res.end();});});
 async function close(){
  for(const u of upstreams)u.destroy();server.closeAllConnections();
  if(server.listening)await new Promise<void>(r=>server.close(()=>r()));
  try{await app?.close();}finally{await db.close();}
 }
 try {
  // No elevated role may serve application requests. Admin is only fixture/migration setup.
  const role=(await db.pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  for(const field of ['rolsuper','rolcreatedb','rolcreaterole','rolbypassrls'])assert.equal(role[field],false,field);
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const tenantId=randomUUID();
  await db.admin.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'Fictional browser research agency']);
  async function member(role:string,name:string):Promise<ResearchSession>{
   const userId=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
   await db.admin.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[userId,name]);
   await db.admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,userId,role]);
   await db.admin.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '2 hours')",[hash(token),randomUUID(),hash(csrf),tenantId,userId]);
   return {userId,csrf,cookie:`inveos_session=${token}; inveos_csrf=${csrf}`};
  }
  const owner=await member('reviewer','Fictional policy author'),reviewer=await member('reviewer','Fictional independent reviewer'),collector=await member('investigator','Fictional supplied-file investigator');
  app=await createApp({pool:db.pool,storageRoot:db.storage,allowedOrigins:[origin],demoTenantId:tenantId,demoUserId:owner.userId,sessionTtlSeconds:3600});
  apiAddress=await app.listen({host:'127.0.0.1',port:0});
  async function call(path:string,actor=collector,payload?:object){
   return fetch(apiAddress+path,{method:payload===undefined?'GET':'POST',headers:{cookie:actor.cookie,origin,'x-csrf-token':actor.csrf,...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(15000)});
  }
  async function must<T>(path:string,actor=collector,payload?:object):Promise<T>{
   const response=await call(path,actor,payload),body=await response.text();assert.equal(response.status,200,`${path}: ${body}`);return JSON.parse(body) as T;
  }
  const kase=await must<{id:string}>('/api/cases',owner,{title:'Fictional browser supplied-source research',client:'Fictional client',scope:'Bounded supplied fictional records only; no live provider collection.',jurisdiction:'Synthetic laboratory'});
  const caseId=kase.id,base='/api/cases/'+caseId;
  for(const subject of [reviewer,collector]){
   const access=await must<{version:number}>(base+'/access',owner);
   await must(base+'/access',owner,{id:randomUUID(),expectedVersion:access.version,action:'member_added',subjectId:subject.userId,reason:'Fictional assigned acceptance participant only.'});
  }
  await must(base+'/authority',owner,{purpose:'Fictional supplied-source browser acceptance',lawfulBasis:'Invented data only; no real source approval',scope:'Fictional RDAP, webpage and LEI supplied bytes without linked traversal.',retentionDays:30,minimisation:'Only bounded invented source material and declarations.'});
  async function revokeCollector(){
   const access=await must<{version:number}>(base+'/access',owner);
   await must(base+'/access',owner,{id:randomUUID(),expectedVersion:access.version,action:'member_removed',subjectId:collector.userId,reason:'Fictional current-access clearing acceptance.'});
  }
  return {db,origin,tenantId,caseId,base,owner,reviewer,collector,call,must,requests,traps,revokeCollector,close};
 }catch(error){await close();throw error;}
}

/** Input goes through rendered controls and real API handlers; no app state injection. */
export function researchControls(browser:HostBrowser){
 const quote=JSON.stringify;
 const button=(text:string,scope='document')=>`[...(${scope}?.querySelectorAll('button')??[])].find(b=>b.textContent?.trim()===${quote(text)})`;
 const selector=(css:string)=>`document.querySelector(${quote(css)})`;
 async function wait(expression:string,label:string){await eventually(()=>browser.evaluate<boolean>(`Boolean(${expression})`),label);}
 async function clickExpression(expression:string,label:string){
  await wait(`(()=>{const e=${expression};return e&&e.matches(':enabled,summary')&&e.getClientRects().length})()`,label);
  const xy=await browser.evaluate<{x:number;y:number}>(`(()=>{const e=${expression};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...xy,button:'left',clickCount:1});
  await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...xy,button:'left',clickCount:1});
 }
 const click=(text:string,css?:string)=>clickExpression(button(text,css?selector(css):'document'),'enabled button '+text);
 const clickCss=(css:string)=>clickExpression(selector(css),'enabled control '+css);
 async function fill(css:string,value:string){
  await wait(`${selector(css)}?.matches(':enabled')`,'enabled input '+css);
  await browser.evaluate(`${selector(css)}.focus()`);
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await browser.send('Input.insertText',{text:value});
  assert.equal(await browser.evaluate(`${selector(css)}.value`),value,'filled '+css);
 }
 async function select(css:string,value:string){
  await wait(`${selector(css)}?.matches(':enabled')`,'enabled select '+css);
  await browser.evaluate(`(()=>{const e=${selector(css)};e.value=${quote(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await browser.evaluate(`${selector(css)}.value`),value);
 }
 async function file(css:string,path:string){
  await wait(`${selector(css)}?.matches(':enabled')`,'enabled file input');
  const doc=await browser.send<{root:{nodeId:number}}>('DOM.getDocument');
  const node=await browser.send<{nodeId:number}>('DOM.querySelector',{nodeId:doc.root.nodeId,selector:css});
  await browser.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path]});
 }
 async function submit(label:string,form:string){
  const invalid=await browser.evaluate<Array<{name:string;message:string}>>(`Array.from(${selector(form)}.querySelectorAll('input,select,textarea')).filter(e=>!e.checkValidity()).map(e=>({name:e.name||e.type,message:e.validationMessage}))`);
  assert.deepEqual(invalid,[],'native form constraints for '+label);await click(label,form);
 }
 async function cookies(session:ResearchSession,origin:string){
  await browser.send('Network.clearBrowserCookies');
  for(const part of session.cookie.split('; ')){
   const i=part.indexOf('='),result=await browser.send<{success:boolean}>('Network.setCookie',{name:part.slice(0,i),value:part.slice(i+1),url:origin,httpOnly:part.startsWith('inveos_session='),sameSite:'Strict'});
   assert.equal(result.success,true);
  }
 }
 async function text(css='body'){return browser.evaluate<string>(`${selector(css)}?.textContent||''`);}
 async function textIncludes(value:string,css='body'){await wait(`${selector(css)}?.textContent.includes(${quote(value)})`,'visible '+value);}
 async function screenshot(dir:string,name:string,css?:string){
  await mkdir(dir,{recursive:true});
  for(const [size,width,height] of [['desktop',1440,1000],['narrow',390,844]] as const){
   await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});
   if(css)await browser.evaluate(`${selector(css)}?.scrollIntoView({block:'start'})`);
   // A frame after resize avoids recording the preceding responsive layout.
   await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   await writeFile(join(dir,name+'-'+size+'.png'),Buffer.from((await browser.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
  }
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 }
 return {wait,click,clickCss,fill,select,file,submit,cookies,text,textIncludes,screenshot};
}
