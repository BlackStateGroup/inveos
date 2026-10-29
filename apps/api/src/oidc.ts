/** Deliberately limited OIDC code/PKCE profile; no discovery, password or token persistence. */
import {createHash,createHmac,createPublicKey,verify,type JsonWebKey} from 'node:crypto';
import {closeSync,constants,fstatSync,openSync,readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {parseDocumentRaw} from './document-derivative.js';
const fail=():never=>{throw new Error('Identity sign-in could not be verified.');};
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;};
const text=(v:unknown,max=512):string=>{if(typeof v!=='string'||!v.length||v.length>max||/[\u0000-\u0020\u007f]/.test(v))return fail();return v;};
export const identityHash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const loginSecret=(secret:string,state:string,purpose:'nonce'|'verifier')=>createHmac('sha256',secret).update('inveos-oidc-v1\0'+purpose+'\0'+state).digest('base64url');
export type IdentityProvider=Readonly<{issuer:string;redirectUri:string;returnUri:string;fingerprint:string;secure:boolean;authorise:(state:string,secret:string)=>string;exchange:(code:string,state:string,secret:string)=>Promise<string>}>;
export function identityProvider(input:unknown,allowLoopback=false):IdentityProvider {
 const config=record(input);
 const expected=['format','issuer','authorizationEndpoint','tokenEndpoint','clientId','redirectUri','returnUri','requiredAcr','requiredAmr','keys'];
 if(config.format!=='inveos_oidc_pinned_v1'||Object.keys(config).some(k=>!expected.includes(k)))fail();
 const url=(value:unknown)=>{const v=text(value,2048),u=new URL(v);if(u.username||u.password||u.hash||u.search||u.href!==v||!(u.protocol==='https:'||(allowLoopback&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))fail();return u;};
 const issuer=url(config.issuer).href,authorisation=url(config.authorizationEndpoint),token=url(config.tokenEndpoint),redirect=url(config.redirectUri),returnUri=url(config.returnUri);
 // Fixed same-origin endpoints prevent provider mix-up and configuration redirects.
 if(authorisation.origin!==new URL(issuer).origin||token.origin!==authorisation.origin||redirect.origin!==returnUri.origin||redirect.pathname!=='/api/auth/callback')fail();
 const clientId=text(config.clientId,200),acr=text(config.requiredAcr,200);
 if(!Array.isArray(config.requiredAmr)||config.requiredAmr.length<1||config.requiredAmr.length>8)fail();
 const amr=(config.requiredAmr as unknown[]).map(v=>text(v,80));if(new Set(amr).size!==amr.length)fail();
 if(!Array.isArray(config.keys)||config.keys.length<1||config.keys.length>8)fail();
 const keys=new Map<string,ReturnType<typeof createPublicKey>>();
 for(const value of config.keys as unknown[]){const jwk=record(value),kid=text(jwk.kid,128);if(keys.has(kid)||jwk.kty!=='RSA'||jwk.alg!=='RS256'||jwk.use!=='sig'||Object.keys(jwk).some(k=>!['kty','kid','alg','use','n','e'].includes(k)))fail();const n=text(jwk.n,1024),e=text(jwk.e,16);if(!/^[A-Za-z0-9_-]+$/.test(n)||Buffer.from(n,'base64url').toString('base64url')!==n||e!=='AQAB')fail();const key=createPublicKey({key:jwk as JsonWebKey,format:'jwk'});const bits=key.asymmetricKeyDetails?.modulusLength;if(!bits||bits<2048||bits>4096)fail();keys.set(kid,key);}
 const fingerprint=identityHash(JSON.stringify(config));
 function validate(jwt:unknown,nonce:string):string {
  const raw=text(jwt,12000),parts=raw.split('.');if(parts.length!==3)fail();
  const decode=(part:string)=>{if(!/^[A-Za-z0-9_-]+$/.test(part))return fail();const bytes=Buffer.from(part,'base64url');if(bytes.toString('base64url')!==part)fail();return bytes;};
  const header=record(parseDocumentRaw(decode(parts[0]!)));
  if(header.alg!=='RS256'||(header.typ!==undefined&&header.typ!=='JWT')||Object.keys(header).some(k=>!['alg','kid','typ'].includes(k)))fail();
  const key=keys.get(text(header.kid,128));if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,decode(parts[2]!)))fail();
  const claims=record(parseDocumentRaw(decode(parts[1]!))),now=Math.floor(Date.now()/1000);
  const integer=(v:unknown):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v))return fail();return v;};
  if(claims.iss!==issuer||claims.aud!==clientId||(claims.azp!==undefined&&claims.azp!==clientId)||claims.nonce!==nonce||claims.acr!==acr)fail();
  const issued=integer(claims.iat),expires=integer(claims.exp),auth=integer(claims.auth_time);
  if(issued>now+30||issued<now-330||expires<=now||expires<=issued||expires>issued+3600||auth>now+30||auth<now-330||auth>issued+30||(claims.nbf!==undefined&&integer(claims.nbf)>now+30))fail();
  if(!Array.isArray(claims.amr)||claims.amr.length>16||!claims.amr.every(v=>typeof v==='string')||!amr.every(v=>(claims.amr as string[]).includes(v)))fail();
  return text(claims.sub,255);
 }
 return Object.freeze({issuer,redirectUri:redirect.href,returnUri:returnUri.href,fingerprint,secure:redirect.protocol==='https:',
  authorise(state:string,secret:string){const u=new URL(authorisation);u.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirect.href,scope:'openid',state,nonce:loginSecret(secret,state,'nonce'),code_challenge:createHash('sha256').update(loginSecret(secret,state,'verifier')).digest('base64url'),code_challenge_method:'S256',max_age:'300',acr_values:acr}).toString();return u.href;},
  async exchange(code:string,state:string,secret:string){
   const response=await fetch(token,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:clientId,redirect_uri:redirect.href,code_verifier:loginSecret(secret,state,'verifier')})});
   if(!response.ok||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body){await response.body?.cancel();return fail();}
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384)fail();chunks.push(part.value);}}finally{await reader.cancel();}
   const body=record(parseDocumentRaw(Buffer.concat(chunks)));if(body.error!==undefined)fail();
   return validate(body.id_token,loginSecret(secret,state,'nonce'));
  }});
}
export function identityFromEnv(env:NodeJS.ProcessEnv):IdentityProvider|undefined {
 if(env.INVEOS_IDENTITY_MODE===undefined||env.INVEOS_IDENTITY_MODE==='demo')return undefined;
 if(env.INVEOS_IDENTITY_MODE!=='oidc-pinned')fail();
 const path=env.INVEOS_IDENTITY_CONFIG??'';if(!isAbsolute(path))fail();let fd:number|undefined;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=fstatSync(fd);if(!stat.isFile()||stat.size<1||stat.size>32768||(stat.mode&0o077)!==0)fail();const raw=readFileSync(fd);if(raw.length>32768)fail();return identityProvider(parseDocumentRaw(raw),env.INVEOS_IDENTITY_LOOPBACK_TEST==='1'&&env.INVEOS_DEV_LAB==='1'&&env.NODE_ENV!=='production');}catch{return fail();}finally{if(fd!==undefined)closeSync(fd);}
}
