import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request as proxyRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../src/app.js';
import {createPool,runMigrations} from '../src/db.js';
import {identityProvider,identityHash} from '../src/oidc.js';
import {fictionalProvider} from './support/identity-provider.js';
import {launchBrowser,eventually} from './support/browser.js';
const tenant='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002';
const cookies=(headers:string|string[]|undefined)=>(Array.isArray(headers)?headers:[headers]).filter(Boolean).map(c=>c!.split(';')[0]).join('; ');
async function setup(){
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminUrl,'Disposable PostgreSQL required');assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='identity_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,schema,2);await runMigrations(admin,schema);const pool=createPool(database,schema,4),root=await mkdtemp(join(tmpdir(),'inveos-identity-')),fixture=await fictionalProvider(),binding=randomUUID();
 await admin.query('INSERT INTO identity_bindings (id,issuer,subject,tenant_id,user_id) VALUES ($1,$2,$3,$4,$5)',[binding,fixture.issuer,'fictional-reviewer',tenant,user]);
 return {admin,pool,root,fixture,binding,async close(){await fixture.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});}};
}
test('provider sessions persist, consume state once, deny unbound identities and enforce current server membership',{timeout:30000},async()=>{
 const f=await setup(),origin='http://localhost:5173';let provider=identityProvider(f.fixture.config(origin),true),epoch=randomUUID();
 const make=()=>createApp({pool:f.pool,storageRoot:f.root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:user,sessionTtlSeconds:3600,sessionEpoch:epoch,identity:provider});let app=await make();
 const start=async()=>{const r=await app.inject({method:'POST',url:'/api/auth/start',headers:{origin},payload:{}});assert.equal(r.statusCode,200,r.body);const callback=await f.fixture.code(r.json().url);return {url:callback.pathname+callback.search,cookie:cookies(r.headers['set-cookie']),state:callback.searchParams.get('state')!};};
 const finish=(attempt:{url:string;cookie:string})=>app.inject({method:'GET',url:attempt.url,headers:{cookie:attempt.cookie}});
 try{
  assert.equal((await app.inject({method:'POST',url:'/api/session/start',headers:{origin},payload:{}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/start',headers:{origin:'https://untrusted.invalid'},payload:{}})).statusCode,403);
  const attempt=await start(),results=await Promise.all([finish(attempt),finish(attempt)]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[302,401]);assert.equal(f.fixture.exchanges,1);
  const success=results.find(r=>r.statusCode===302)!,session=cookies(success.headers['set-cookie']);assert.equal(success.headers.location,origin+'/');assert.equal(success.headers['referrer-policy'],'no-referrer');assert.ok(session.includes('inveos_session='));assert.equal((await app.inject({method:'GET',url:'/api/workspace',headers:{cookie:session}})).statusCode,200);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM sessions WHERE identity_id=$1',[f.binding])).rows[0].n,1);
  const wrong=await start(),before=f.fixture.exchanges;assert.equal((await finish({...wrong,cookie:'inveos_login='+('x'.repeat(43))})).statusCode,401);assert.equal(f.fixture.exchanges,before);assert.equal((await finish(wrong)).statusCode,302);
  const expired=await start();await f.admin.query('UPDATE identity_login_attempts SET expires_at=now()-interval \'1 second\' WHERE state_hash=$1',[identityHash(expired.state)]);assert.equal((await finish(expired)).statusCode,401);
  f.fixture.setSubject('unmapped');const unknown=await start();assert.equal((await finish(unknown)).statusCode,401);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM identity_bindings')).rows[0].n,1);f.fixture.setSubject('fictional-reviewer');
  // Recreate API instances without dropping PostgreSQL to exercise persistent login state/session restore.
  await app.close();app=await make();assert.equal((await app.inject({method:'GET',url:'/api/workspace',headers:{cookie:session}})).statusCode,200);
  f.fixture.setMode('amr');const weak=await start();assert.equal((await finish(weak)).statusCode,401);assert.equal((await finish(weak)).statusCode,401);f.fixture.setMode('valid');
  const pending=await start();await app.close();app=await make();assert.equal((await finish(pending)).statusCode,302);
  await assert.rejects(()=>f.pool.query('UPDATE identity_bindings SET revoked_at=now() WHERE id=$1',[f.binding]),/permission denied/);
  await assert.rejects(()=>f.admin.query('UPDATE identity_bindings SET subject=$1 WHERE id=$2',['reassigned',f.binding]),/immutable/);
  await assert.rejects(()=>f.pool.query('UPDATE sessions SET identity_id=NULL,identity_profile_hash=NULL WHERE identity_id=$1',[f.binding]),/immutable/);
  const csrf=session.match(/inveos_csrf=([^;]+)/)![1]!;await f.admin.query('UPDATE memberships SET role=\'client\' WHERE tenant_id=$1 AND user_id=$2',[tenant,user]);
  assert.equal((await app.inject({method:'POST',url:'/api/cases',headers:{cookie:session,origin,'x-csrf-token':csrf},payload:{title:'Fictional denied',client:'Fictional',scope:'Fictional only',jurisdiction:'England'}})).statusCode,403);
  await f.admin.query('UPDATE memberships SET role=\'reviewer\' WHERE tenant_id=$1 AND user_id=$2',[tenant,user]);
  await app.close();provider=identityProvider({...f.fixture.config(origin),requiredAmr:['otp','pwd']},true);app=await make();assert.equal((await app.inject({method:'GET',url:'/api/workspace',headers:{cookie:session}})).statusCode,401);
  await app.close();provider=identityProvider(f.fixture.config(origin),true);app=await make();const oldAttempt=await start();await app.close();epoch=randomUUID();app=await make();assert.equal((await finish(oldAttempt)).statusCode,401);assert.equal((await app.inject({method:'GET',url:'/api/workspace',headers:{cookie:session}})).statusCode,401);
  const valid=await finish(await start());assert.equal(valid.statusCode,302);const current=cookies(valid.headers['set-cookie']);await f.admin.query('UPDATE identity_bindings SET revoked_at=now() WHERE id=$1',[f.binding]);assert.equal((await app.inject({method:'GET',url:'/api/workspace',headers:{cookie:current}})).statusCode,401);assert.equal((await finish(await start())).statusCode,401);await assert.rejects(()=>f.admin.query('UPDATE identity_bindings SET revoked_at=NULL WHERE id=$1',[f.binding]),/immutable/);
  const audit=(await f.pool.query("SELECT summary,metadata FROM audit_events WHERE action='session.started'")).rows;assert.ok(audit.length>=3);assert.equal(JSON.stringify(audit).includes('not-retained'),false);
 }finally{await app.close();await f.close();}
});
test('sandboxed browser signs in through the fictional provider, creates a case, reloads and loses access on revocation',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:60000},async t=>{
 const f=await setup(),dist=fileURLToPath(new URL('../../web/dist/',import.meta.url));let apiAddress='';const httpStatuses:string[]=[];
 const server=createServer((req,res)=>{void(async()=>{const path=new URL(req.url!,'http://localhost').pathname;if(path.startsWith('/api/')){const upstream=proxyRequest(apiAddress+req.url,{method:req.method,headers:req.headers},response=>{httpStatuses.push(path+':'+response.statusCode);res.writeHead(response.statusCode!,response.headers);response.pipe(res);});upstream.on('error',()=>res.writeHead(502).end());req.pipe(upstream);return;}if(path==='/'||path==='/portal'){res.setHeader('content-type','text/html');res.end(await readFile(join(dist,'index.html')));return;}if(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path)){res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(dist,path.slice(1))));return;}res.writeHead(404).end();})().catch(()=>res.writeHead(500).end());});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const app=await createApp({pool:f.pool,storageRoot:f.root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:user,sessionTtlSeconds:3600,identity:identityProvider(f.fixture.config(origin),true)});let browser:Awaited<ReturnType<typeof launchBrowser>>|undefined;
 try{
  apiAddress=await app.listen({host:'127.0.0.1',port:0});browser=await launchBrowser();const b=browser;await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await b.send('Page.navigate',{url:origin});
  await eventually(async()=>await b.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Open persistent lab'))`),'workspace load');
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Open persistent lab')).click()`);
  await eventually(async()=>await b.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Sign in with provider')&&!b.disabled)`),'provider mode');
  await b.evaluate(`document.querySelector('input[type=checkbox]').click();[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Sign in with provider')).click()`);
  try{await eventually(async()=>await b.evaluate(`location.origin===${JSON.stringify(origin)}&&document.body?.innerText.includes('PERSISTENT SYNTHETIC LAB')`),'provider return and restored workspace');}catch(error){t.diagnostic(JSON.stringify(await b.evaluate(`({path:location.pathname,body:document.body.innerText.slice(0,3500),cookieNames:document.cookie.split(';').map(v=>v.split('=')[0])})`)));t.diagnostic('Token exchanges: '+f.fixture.exchanges+'; HTTP '+JSON.stringify(httpStatuses));throw error;}
  assert.equal(await b.evaluate<number>(`fetch('/api/session/me').then(r=>r.status)`),200);
  assert.equal(await b.evaluate(`document.cookie.includes('inveos_session=')`),false);assert.equal(await b.evaluate(`document.cookie.includes('inveos_login=')`),false);
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('New case')).click()`);
  await eventually(async()=>await b.evaluate(`!!document.querySelector('input[name=title]')`),'case form');
  await b.evaluate(`document.querySelector('input[name=title]').value='Fictional provider case';document.querySelector('input[name=client]').value='Fictional client';document.querySelector('textarea[name=scope]').value='Synthetic records only';[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Create case')).click()`);
  await eventually(async()=>await b.evaluate(`document.body.innerText.includes('Fictional provider case')&&!document.querySelector('input[name=title]')`),'case saved through form');
  await b.send('Page.reload');await eventually(async()=>await b.evaluate(`document.body.innerText.includes('Fictional provider case')`),'case persisted after reload');
  await f.admin.query('UPDATE identity_bindings SET revoked_at=now() WHERE id=$1',[f.binding]);assert.equal(await b.evaluate<number>(`fetch('/api/workspace').then(r=>r.status)`),401);
  const clientId=randomUUID();await f.admin.query('INSERT INTO users(id,display_name) VALUES ($1,$2)',[clientId,'Fictional portal recipient']);await f.admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,\'client\')',[tenant,clientId]);await f.admin.query('INSERT INTO identity_bindings(id,issuer,subject,tenant_id,user_id) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),f.fixture.issuer,'fictional-client',tenant,clientId]);f.fixture.setSubject('fictional-client');
  await b.send('Page.navigate',{url:origin+'/portal'});await eventually(async()=>await b.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Sign in with provider')`),'client sign-in');await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign in with provider').click()`);
  await eventually(async()=>await b.evaluate(`location.pathname==='/portal'&&document.body.innerText.includes('Client disclosures')&&document.cookie.includes('inveos_csrf=')`),'client provider return');
  await eventually(async()=>await b.evaluate(`fetch('/api/session/me').then(async r=>r.ok&&(await r.json()).role==='client')`),'server client identity');
  assert.equal(await b.evaluate<number>(`fetch('/api/workspace').then(r=>r.status)`),403);await eventually(async()=>await b.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh disclosures'&&!b.disabled)`),'client disclosure controls ready');await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh disclosures').click()`);await eventually(async()=>await b.evaluate(`document.body.innerText.includes('No currently available disclosures.')`),'no implicit disclosure grant');
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign out').click()`);await eventually(async()=>await b.evaluate(`document.body.innerText.includes('Session ended.')`),'client logout');assert.equal(await b.evaluate<number>(`fetch('/api/portal/disclosures').then(r=>r.status)`),401);
  t.diagnostic(JSON.stringify({provider:'first-party fictional HTTP/RSA fixture',actualProviderMfaVerified:false,browserSignIn:true,casePersisted:true,reload:true,revocation:true,clientProviderReturn:true,noImplicitDisclosures:true,clientLogout:true}));
 }finally{await browser?.close();await app.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.close();}
});

test('enrolled identities remain tenant/case scoped, logout revokes and demo cookies cannot cross identity modes',{timeout:30000},async()=>{
 const f=await setup(),origin='http://localhost:5173',options={pool:f.pool,storageRoot:f.root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:user,sessionTtlSeconds:3600};let app=await createApp(options);
 try{
  const demo=await app.inject({method:'POST',url:'/api/session/start',headers:{origin},payload:{}});assert.equal(demo.statusCode,200);const demoCookie=cookies(demo.headers['set-cookie']);await app.close();app=await createApp({...options,identity:identityProvider(f.fixture.config(origin),true)});
  assert.equal((await app.inject({method:'GET',url:'/api/workspace',headers:{cookie:demoCookie}})).statusCode,401);
  const login=async(subject:string)=>{f.fixture.setSubject(subject);const start=await app.inject({method:'POST',url:'/api/auth/start',headers:{origin},payload:{}});assert.equal(start.statusCode,200,start.body);const redirect=await f.fixture.code(start.json().url);const finish=await app.inject({method:'GET',url:redirect.pathname+redirect.search,headers:{cookie:cookies(start.headers['set-cookie'])}});assert.equal(finish.statusCode,302,finish.body);const cookie=cookies(finish.headers['set-cookie']),csrf=cookie.match(/inveos_csrf=([^;]+)/)![1]!;return {cookie,origin,'x-csrf-token':csrf};};
  const reviewer=await login('fictional-reviewer');const created=await app.inject({method:'POST',url:'/api/cases',headers:reviewer,payload:{title:'Fictional private case',client:'Fictional client',scope:'Only fictional supplied records',jurisdiction:'England'}});assert.equal(created.statusCode,200,created.body);const id=created.json().id;
  const otherTenant=randomUUID(),otherUser=randomUUID(),outsider=randomUUID();await f.admin.query('INSERT INTO tenants(id,name) VALUES ($1,$2)',[otherTenant,'Fictional separate agency']);
  for(const [uid,tid,sub] of [[otherUser,otherTenant,'other-tenant'],[outsider,tenant,'same-tenant-no-case']]){await f.admin.query('INSERT INTO users(id,display_name) VALUES ($1,$2)',[uid,'Fictional separate reviewer']);await f.admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,\'reviewer\')',[tid,uid]);await f.admin.query('INSERT INTO identity_bindings(id,issuer,subject,tenant_id,user_id) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),f.fixture.issuer,sub,tid,uid]);}
  for(const subject of ['other-tenant','same-tenant-no-case']){
   const headers=await login(subject);const workspace=await app.inject({method:'GET',url:'/api/workspace',headers});assert.equal(workspace.statusCode,200,workspace.body);assert.equal(workspace.json().cases.some((c:{id:string})=>c.id===id),false);
   for(const path of ['/report','/work','/evidence']){const denied=await app.inject({method:'GET',url:'/api/cases/'+id+path,headers});assert.equal(denied.statusCode,404,denied.body);}
   const denied=await app.inject({method:'POST',url:'/api/cases/'+id+'/authority',headers,payload:{purpose:'Fictional forbidden access',lawfulBasis:'Synthetic only',scope:'Only fictional supplied records',retentionDays:30,minimisation:'No real data'}});assert.equal(denied.statusCode,404,denied.body);
  }
  assert.equal((await app.inject({method:'POST',url:'/api/session/end',headers:{cookie:reviewer.cookie,origin},payload:{}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/session/end',headers:reviewer,payload:{}})).statusCode,200);assert.equal((await app.inject({method:'GET',url:'/api/workspace',headers:reviewer})).statusCode,401);
  const active=await login('fictional-reviewer');await app.close();app=await createApp(options);assert.equal((await app.inject({method:'GET',url:'/api/workspace',headers:active})).statusCode,401);
  const history=await f.admin.query('SELECT action FROM identity_binding_history ORDER BY sequence');assert.deepEqual(history.rows.map(r=>r.action),['enrolled','enrolled','enrolled']);
 }finally{await app.close();await f.close();}
});
