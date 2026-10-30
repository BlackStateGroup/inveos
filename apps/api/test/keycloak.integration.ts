import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../src/app.js';
import {createPool,runMigrations} from '../src/db.js';
import {identityProvider} from '../src/oidc.js';
import {launchBrowser,eventually} from './support/browser.js';
import {forwardBrowserApi} from './support/browser-proxy.js';

const origin='http://127.0.0.1:58991',issuer='http://127.0.0.1:58992/realms/inveos-fictional';
const tenant='00000000-0000-4000-8000-000000000001',reviewer='00000000-0000-4000-8000-000000000002';
function otp(name:string,offset=0){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+offset));const digest=createHmac('sha1','FictionalOtpSeedOnly'+name).update(counter).digest(),start=digest[19]!&15;return String((digest.readUInt32BE(start)&0x7fffffff)%1000000).padStart(6,'0');}

test('actual Keycloak password and OTP authenticate enrolled identities and preserve application boundaries',{timeout:170000},async t=>{
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;
 assert.ok(database&&adminUrl,'Disposable PostgreSQL required');assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='keycloak_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,schema,2);await runMigrations(admin,schema);
 const pool=createPool(database,schema,4),root=await mkdtemp(join(tmpdir(),'inveos-keycloak-app-')),dist=fileURLToPath(new URL('../../web/dist/',import.meta.url));
 const outcomes:string[]=[];let address='',callback='';
 const server=createServer((req,res)=>{void(async()=>{const path=new URL(req.url!,origin).pathname;if(path.startsWith('/api/')){if(path==='/api/auth/callback')callback=req.url!;forwardBrowserApi(req,res,address+req.url);return;}
  if(path==='/'||path==='/portal'){res.setHeader('content-type','text/html');res.end(await readFile(join(dist,'index.html')));return;}
  if(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path)){res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(dist,path.slice(1))));return;}res.writeHead(404).end();})().catch(()=>res.writeHead(500).end());});
 let app:Awaited<ReturnType<typeof createApp>>|undefined,browser:Awaited<ReturnType<typeof launchBrowser>>|undefined;
 try{
  const response=await fetch(issuer+'/protocol/openid-connect/certs',{redirect:'error',signal:AbortSignal.timeout(5000)});assert.ok(response.ok);const raw=await response.text();assert.ok(Buffer.byteLength(raw)<32768);
  const jwks=JSON.parse(raw) as {keys:Record<string,string>[]};const keys=jwks.keys.filter(k=>k.alg==='RS256'&&k.use==='sig').map(({kty,kid,alg,use,n,e})=>({kty,kid,alg,use,n,e}));assert.equal(keys.length,1);
  const config={format:'inveos_oidc_pinned_v1',issuer,authorizationEndpoint:issuer+'/protocol/openid-connect/auth',tokenEndpoint:issuer+'/protocol/openid-connect/token',clientId:'inveos-fictional',redirectUri:origin+'/api/auth/callback',returnUri:origin+'/',requiredAcr:'2',requiredAmr:['pwd','otp'],keys};
  const bindings:string[]=[];
  for(const [number,role,uid] of [[1,'reviewer',reviewer],[2,'client',randomUUID()],[3,'reviewer',randomUUID()]] as const){
   if(number!==1){await admin.query('INSERT INTO users(id,display_name) VALUES ($1,$2)',[uid,'Fictional Keycloak '+role]);await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,$3)',[tenant,uid,role]);}
   const binding=randomUUID();bindings.push(binding);await admin.query('INSERT INTO identity_bindings(id,issuer,subject,tenant_id,user_id) VALUES ($1,$2,$3,$4,$5)',[binding,issuer,'10000000-0000-4000-8000-'+String(number).padStart(12,'0'),tenant,uid]);
  }
  const make=async(requiredAmr=['pwd','otp'])=>{app=await createApp({pool,storageRoot:root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:reviewer,sessionTtlSeconds:3600,identity:identityProvider({...config,requiredAmr},true)});address=await app.listen({host:'127.0.0.1',port:0});};
  await make();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(58991,'127.0.0.1',resolve);});
  browser=await launchBrowser();const b=browser;await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const evaluate=b.evaluate;
  const has=(selector:string)=>evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
  const fill=(selector:string,value:string)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);
  const click=(selector:string)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const status=(path:string)=>evaluate<number>(`fetch(${JSON.stringify(path)}).then(r=>r.status)`);
  const button=(label:string)=>evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)})&&!b.disabled).click()`);
  async function start(name:string,portal=false){
   await b.send('Network.clearBrowserCookies');await b.send('Page.navigate',{url:origin+(portal?'/portal':'/')});
   if(!portal){await eventually(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Open persistent lab'))`),'application entry');await button('Open persistent lab');}
   await eventually(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Sign in with provider')&&!b.disabled)`),'real provider entry');
   if(!portal)await click('input[type=checkbox]');await button('Sign in with provider');
   await eventually(()=>has('#username'),'Keycloak password screen');await fill('#username','fictional-'+name);
  }
  async function submit(){const before=await evaluate<number>('performance.timeOrigin');await click('#kc-login');await eventually(()=>evaluate<boolean>('performance.timeOrigin!=='+before).catch(()=>false),'provider form navigation');}
  async function password(value='Fictional-test-only-2026!'){await fill('#password',value);await submit();}
  async function complete(name:string,expected=200){await password();await eventually(()=>has('#otp'),'Keycloak OTP screen');await fill('#otp',otp(name));await submit();await eventually(()=>evaluate(`location.origin===${JSON.stringify(origin)}`),'provider callback');await eventually(async()=>await status('/api/session/me')===expected,'server identity outcome');}
  await start('reviewer');await password('fictional-wrong-password');await eventually(()=>evaluate(`document.body.innerText.includes('Invalid username or password')`),'wrong password denied');outcomes.push('actual wrong password denied');
  await password();await eventually(()=>has('#otp'),'actual second factor required');assert.equal((await pool.query('SELECT count(*)::int AS n FROM sessions WHERE identity_id IS NOT NULL')).rows[0].n,0);outcomes.push('password alone grants no INVEOS session');
  await fill('#otp',otp('reviewer',-20));await submit();await eventually(()=>evaluate(`document.body.innerText.includes('Invalid authenticator code')`),'expired OTP denied');outcomes.push('actual expired OTP denied');
  await fill('#otp','not-an-otp');await submit();await eventually(()=>evaluate(`document.body.innerText.includes('Invalid authenticator code')`),'malformed OTP denied');outcomes.push('actual malformed OTP denied');
  await fill('#otp',otp('reviewer'));await submit();await eventually(()=>evaluate(`location.origin===${JSON.stringify(origin)}`),'actual MFA callback');await eventually(async()=>await status('/api/session/me')===200,'real MFA identity');outcomes.push('real password plus OTP and signed acr/amr accepted');
  assert.equal(await evaluate(`document.cookie.includes('inveos_session=')||document.cookie.includes('inveos_login=')`),false);outcomes.push('session and login cookies remain HttpOnly');
  assert.equal(await status(callback),401);outcomes.push('consumed real callback cannot replay');
  // Replayed callback clears login state, not the established application session.
  await b.send('Page.navigate',{url:origin});await eventually(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('New case'))`),'signed-in application');await button('New case');await eventually(()=>has('input[name=title]'),'case form');
  await fill('input[name=title]','Fictional actual MFA case');await fill('input[name=client]','Fictional client');await fill('textarea[name=scope]','Fictional supplied records only');await button('Create case');await eventually(()=>evaluate(`document.body.innerText.includes('Fictional actual MFA case')&&!document.querySelector('input[name=title]')`),'case created through MFA');
  const workspace=await evaluate<{cases:{id:string;title:string}[]}>(`fetch('/api/workspace').then(r=>r.json())`),caseId=workspace.cases.find(c=>c.title==='Fictional actual MFA case')!.id;outcomes.push('case creation through actual MFA');
  await b.send('Page.reload');await eventually(()=>evaluate(`document.body.innerText.includes('Fictional actual MFA case')`),'case reload');outcomes.push('saved case reload');
  await app!.close();await make();assert.equal(await status('/api/workspace'),200);outcomes.push('application restart preserves enrolled session');
  await mkdir('output/evals/keycloak',{recursive:true});const shot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png'});await writeFile('output/evals/keycloak/keycloak-workspace.png',Buffer.from(shot.data,'base64'));
  await admin.query('UPDATE identity_bindings SET revoked_at=now() WHERE id=$1',[bindings[0]]);assert.equal(await status('/api/workspace'),401);outcomes.push('binding withdrawal immediately denies existing session');
  await start('reviewer');await complete('reviewer',401);outcomes.push('revoked enrolled subject cannot sign in again despite actual MFA');
  await start('unbound');await complete('unbound',401);assert.equal((await pool.query('SELECT count(*)::int AS n FROM identity_bindings')).rows[0].n,3);outcomes.push('unmapped actual provider subject denied without automatic enrolment');
  await start('outsider');await complete('outsider');for(const suffix of ['/work','/evidence','/report'])assert.equal(await status('/api/cases/'+caseId+suffix),404);outcomes.push('same-tenant actual provider identity cannot access an unassigned case');
  await start('client',true);await complete('client');assert.equal(await status('/api/workspace'),403);assert.equal(await status('/api/cases/'+caseId+'/work'),403);outcomes.push('actual client identity cannot enter internal workspace or case');
  await eventually(()=>evaluate(`document.body.innerText.includes('Client disclosures')`),'portal return');assert.equal(await evaluate(`fetch('/api/portal/disclosures').then(r=>r.json()).then(x=>JSON.stringify(x).includes(${JSON.stringify(caseId)}))`),false);outcomes.push('actual MFA gives no implicit client disclosure');
  await button('Sign out');await eventually(async()=>await status('/api/session/me')===401,'logout');outcomes.push('application logout revokes actual provider session');
  await app!.close();await make(['pwd','otp','hwk']);await start('outsider');await complete('outsider',401);outcomes.push('real provider token lacking required hardware method is rejected');
  const audit=await pool.query("SELECT metadata FROM audit_events WHERE action='session.started'");assert.equal(JSON.stringify(audit.rows).includes('FictionalOtpSeedOnly'),false);assert.equal(JSON.stringify(audit.rows).includes('Fictional-test-only'),false);outcomes.push('audit excludes password and OTP seed');
  await writeFile('output/evals/keycloak/browser-receipt.json',JSON.stringify({provider:'Keycloak 26.8.1',issuer,fictionalOnly:true,outcomes,productionApproval:false,nativeDeviceAcceptance:false},null,2)+'\n');t.diagnostic(JSON.stringify({actualProvider:true,actualOtp:true,checks:outcomes.length,outcomes}));
 }catch(error){if(browser)t.diagnostic(JSON.stringify(await browser.evaluate(`({path:location.pathname,body:document.body?.innerText.slice(0,1800)})`).catch(()=>({browserUnavailable:true}))));throw error;}
 finally{await browser?.close();await app?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});}
});
