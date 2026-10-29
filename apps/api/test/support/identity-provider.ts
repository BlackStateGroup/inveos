/** First-party fictional protocol fixture, not a deployed identity product or MFA authenticator. */
import {createServer} from 'node:http';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
export async function fictionalProvider(){
 const pair=generateKeyPairSync('rsa',{modulusLength:2048}),other=generateKeyPairSync('rsa',{modulusLength:2048});
 const publicKey={...pair.publicKey.export({format:'jwk'}),kid:'fixture-1',alg:'RS256',use:'sig'};
 const codes=new Map<string,{nonce:string;challenge:string;redirect:string}>();let issuer='',mode='valid',subject='fictional-reviewer',exchanges=0;
 const server=createServer((request,response)=>{void(async()=>{
  const u=new URL(request.url!,issuer);
  if(u.pathname==='/authorise'){
   const p=u.searchParams;if(p.get('client_id')!=='inveos-fictional'||p.get('response_type')!=='code'||p.get('code_challenge_method')!=='S256'||p.get('scope')!=='openid'||p.get('max_age')!=='300'){response.writeHead(400).end();return;}
   const code=randomUUID();codes.set(code,{nonce:p.get('nonce')!,challenge:p.get('code_challenge')!,redirect:p.get('redirect_uri')!});const next=new URL(p.get('redirect_uri')!);next.search=new URLSearchParams({code,state:p.get('state')!,iss:issuer}).toString();response.writeHead(302,{location:next.href}).end();return;
  }
  if(u.pathname!=='/token'||request.method!=='POST'){response.writeHead(404).end();return;}
  exchanges++;let body='';for await(const chunk of request){body+=String(chunk);if(body.length>4096){response.writeHead(413).end();return;}}
  const p=new URLSearchParams(body),code=codes.get(p.get('code')!);codes.delete(p.get('code')!);
  if(!code||p.get('client_id')!=='inveos-fictional'||p.get('grant_type')!=='authorization_code'||p.get('redirect_uri')!==code.redirect||createHash('sha256').update(p.get('code_verifier')??'').digest('base64url')!==code.challenge){response.writeHead(400,{'content-type':'application/json'}).end('{"error":"invalid_grant"}');return;}
  if(mode==='redirect'){response.writeHead(302,{location:issuer+'forbidden'}).end();return;}
  const now=Math.floor(Date.now()/1000),claims:Record<string,unknown>={iss:issuer,sub:subject,aud:'inveos-fictional',iat:now,exp:now+300,auth_time:now,nonce:code.nonce,acr:'fictional-mfa',amr:['pwd','otp'],roles:['reviewer'],email:'ignored@example.invalid'};
  const mutations:Record<string,object>={issuer:{iss:issuer+'wrong'},audience:{aud:'another-client'},nonce:{nonce:'wrong'},expired:{exp:now-1},future:{iat:now+120},stale:{auth_time:now-500},amr:{amr:['pwd']},acr:{acr:'weak'},azp:{azp:'other'},arrayAudience:{aud:['inveos-fictional','other']},subject:{sub:''},missingAuth:{auth_time:undefined},nbf:{nbf:now+120}};
  Object.assign(claims,mutations[mode]);const header={alg:mode==='algorithm'?'HS256':'RS256',kid:mode==='unknownKey'?'other':'fixture-1',...(mode==='jku'?{jku:issuer+'keys'}:{}),...(mode==='crit'?{crit:['b64']}:{} )};
  let payload=JSON.stringify(claims);if(mode==='duplicate')payload=payload.replace('"aud":','"aud":"attacker","aud":');
  const signing=Buffer.from(JSON.stringify(header)).toString('base64url')+'.'+Buffer.from(payload).toString('base64url');let jwt=signing+'.'+sign('RSA-SHA256',Buffer.from(signing),mode==='signature'?other.privateKey:pair.privateKey).toString('base64url');if(mode==='oversize')jwt='x'.repeat(17000);
  response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id_token:jwt,access_token:'not-retained',token_type:'Bearer'}));
 })().catch(()=>response.writeHead(500).end());});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture server unavailable');issuer='http://127.0.0.1:'+address.port+'/';
 return {issuer,publicKey,get exchanges(){return exchanges;},setMode(value:string){mode=value;},setSubject(value:string){subject=value;},config(origin:string){return {format:'inveos_oidc_pinned_v1',issuer,authorizationEndpoint:issuer+'authorise',tokenEndpoint:issuer+'token',clientId:'inveos-fictional',redirectUri:origin+'/api/auth/callback',returnUri:origin+'/',requiredAcr:'fictional-mfa',requiredAmr:['pwd','otp'],keys:[publicKey]};},async code(url:string){const r=await fetch(url,{redirect:'manual'});if(r.status!==302)throw new Error('Fixture authorisation rejected');return new URL(r.headers.get('location')!);},close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
