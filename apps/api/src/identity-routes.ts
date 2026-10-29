import {randomBytes,randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {inTransaction} from './db.js';
import {identityHash,type IdentityProvider} from './oidc.js';

/** Local sessions carry identity only; all tenant, case and role decisions remain in PostgreSQL. */
export function identityRoutes(app:FastifyInstance,options:{pool:Pool;identity?:IdentityProvider;allowedOrigins:string[];epoch:string;sessionTtlSeconds:number}){
 const provider=options.identity,cookie='inveos_login';
 app.get('/api/auth/mode',async()=>({mode:provider?'provider':'demo'}));
 app.post('/api/auth/start',{config:{rateLimit:{max:5,timeWindow:60000}},schema:{body:{type:'object',additionalProperties:false,maxProperties:0}}},async(request,reply)=>{
  if(!provider)return reply.code(404).send({error:'Provider sign-in is unavailable.'});
  if(!request.headers.origin||!options.allowedOrigins.includes(request.headers.origin)||request.headers.origin!==new URL(provider.returnUri).origin)return reply.code(403).send({error:'Allowed origin required.'});
  const state=randomBytes(32).toString('base64url'),secret=randomBytes(32).toString('base64url');
  const admitted=await inTransaction(options.pool,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(640122, 32)');
   await client.query('DELETE FROM identity_login_attempts WHERE state_hash IN (SELECT state_hash FROM identity_login_attempts WHERE expires_at<=now() ORDER BY expires_at LIMIT 1000)');
   const count=await client.query('SELECT count(*)::int AS n FROM identity_login_attempts');if(count.rows[0].n>=10000)return false;
   await client.query('INSERT INTO identity_login_attempts (state_hash,browser_hash,provider_hash,epoch,expires_at) VALUES ($1,$2,$3,$4,now()+interval \'5 minutes\')',[identityHash(state),identityHash(secret),provider.fingerprint,options.epoch]);return true;
  });
  if(!admitted)return reply.code(503).send({error:'Sign-in capacity reached. Try later.'});
  reply.setCookie(cookie,secret,{path:'/api/auth',httpOnly:true,sameSite:'lax',secure:provider.secure,maxAge:300});
  return {url:provider.authorise(state,secret)};
 });
 app.get('/api/auth/callback',{config:{rateLimit:{max:20,timeWindow:60000}}},async(request,reply)=>{
  reply.header('Referrer-Policy','no-referrer');reply.clearCookie(cookie,{path:'/api/auth',httpOnly:true,sameSite:'lax',secure:provider?.secure??false});
  const deny=()=>reply.code(401).send({error:'Identity sign-in could not be verified. Start sign-in again.'});
  if(!provider)return deny();
  const query=request.query as Record<string,unknown>,secret=request.cookies[cookie];
  if(!secret||!(/^[A-Za-z0-9_-]{43}$/).test(secret)||typeof query.state!=='string'||!(/^[A-Za-z0-9_-]{43}$/).test(query.state))return deny();
  try{
   // Burn even failed exchanges; concurrent callbacks cannot mint duplicate sessions.
   const consumed=await options.pool.query('DELETE FROM identity_login_attempts WHERE state_hash=$1 AND browser_hash=$2 AND provider_hash=$3 AND epoch=$4 AND expires_at>now() RETURNING state_hash',[identityHash(query.state),identityHash(secret),provider.fingerprint,options.epoch]);
   if(consumed.rowCount!==1||typeof query.code!=='string'||query.code.length<1||query.code.length>2048||/[\u0000-\u0020\u007f]/.test(query.code)||query.error!==undefined||(query.iss!==undefined&&query.iss!==provider.issuer)||Object.keys(query).some(k=>!['state','code','iss','session_state'].includes(k)))return deny();
   const subject=await provider.exchange(query.code,query.state,secret),token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url'),id=randomUUID();
   const expires=new Date(Date.now()+options.sessionTtlSeconds*1000);
   const created=await inTransaction(options.pool,async client=>{
    const binding=await client.query(`SELECT b.id,b.tenant_id,b.user_id FROM identity_bindings b JOIN memberships m ON m.tenant_id=b.tenant_id AND m.user_id=b.user_id WHERE b.issuer=$1 AND b.subject=$2 AND b.revoked_at IS NULL`,[provider.issuer,subject]);const row=binding.rows[0];if(!row)return false;
    await client.query('INSERT INTO sessions (token_hash,id,csrf_hash,tenant_id,user_id,expires_at,epoch,identity_id,identity_profile_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[identityHash(token),id,identityHash(csrf),row.tenant_id,row.user_id,expires,options.epoch,row.id,provider.fingerprint]);
    await client.query(`INSERT INTO audit_events (id,tenant_id,case_id,actor_user_id,action,entity_type,entity_id,summary) VALUES ($1,$2,NULL,$3,'session.started','session',$4,'Pinned provider sign-in; server membership applied')`,[randomUUID(),row.tenant_id,row.user_id,id]);return true;
   });
   if(!created)return deny();
   // Lax allows the top-level provider redirect to load its first authenticated workspace.
   reply.setCookie('inveos_session',token,{path:'/',httpOnly:true,sameSite:'lax',secure:provider.secure,expires});
   reply.setCookie('inveos_csrf',csrf,{path:'/',httpOnly:false,sameSite:'strict',secure:provider.secure,expires});
   return reply.redirect(provider.returnUri);
  }catch{return deny();}
 });
}
