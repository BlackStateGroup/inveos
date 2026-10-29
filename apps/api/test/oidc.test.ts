import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRuntimeConfig} from '../src/config.js';
import {identityProvider,identityFromEnv} from '../src/oidc.js';
import {fictionalProvider} from './support/identity-provider.js';

test('pinned code exchange checks real RSA signatures, nonce, issuer, audience, freshness, AMR and bounded input',async()=>{
 const fixture=await fictionalProvider();try{
  const provider=identityProvider(fixture.config('http://localhost:5173'),true);
  for(const mode of ['valid','issuer','audience','nonce','expired','future','stale','amr','acr','azp','arrayAudience','subject','missingAuth','nbf','algorithm','unknownKey','jku','crit','signature','duplicate','oversize','redirect']){
   fixture.setMode(mode);const state=randomBytes(32).toString('base64url'),secret=randomBytes(32).toString('base64url'),callback=await fixture.code(provider.authorise(state,secret));
   const run=()=>provider.exchange(callback.searchParams.get('code')!,state,secret);
   if(mode==='valid'){assert.equal(await run(),'fictional-reviewer');await assert.rejects(run);}else await assert.rejects(run,mode);
  }
  fixture.setMode('valid');const state=randomBytes(32).toString('base64url'),secret=randomBytes(32).toString('base64url'),callback=await fixture.code(provider.authorise(state,secret));await assert.rejects(()=>provider.exchange(callback.searchParams.get('code')!,state,'wrong-browser-secret'));
 }finally{await fixture.close();}
});
test('identity configuration is bounded, pinned and refuses insecure or ambiguous keys and unsafe files',async()=>{
 const fixture=await fictionalProvider(),root=await mkdtemp(join(tmpdir(),'inveos-identity-config-'));try{
  const config=fixture.config('http://localhost:5173');assert.throws(()=>identityProvider(config));
  for(const changed of [{tokenEndpoint:'https://elsewhere.invalid/token'},{returnUri:'https://elsewhere.invalid/'},{redirectUri:'http://localhost:5173/wrong'},{requiredAmr:[]},{keys:[{...fixture.publicKey,d:'private'}]},{keys:[fixture.publicKey,fixture.publicKey]},{keys:[{...fixture.publicKey,e:'Aw'}]},{extra:true}])assert.throws(()=>identityProvider({...config,...changed},true));
  const path=join(root,'config.json');await writeFile(path,JSON.stringify(config),{mode:0o600});const env={INVEOS_IDENTITY_MODE:'oidc-pinned',INVEOS_IDENTITY_CONFIG:path,INVEOS_IDENTITY_LOOPBACK_TEST:'1',INVEOS_DEV_LAB:'1'};
  assert.throws(()=>identityFromEnv({INVEOS_IDENTITY_CONFIG:path}));
  assert.throws(()=>loadRuntimeConfig({...env,INVEOS_DATABASE_URL:'postgres://fictional/inveos_test',INVEOS_ADMIN_DATABASE_URL:'postgres://fictional/inveos_test',INVEOS_STORAGE_ROOT:root,INVEOS_ALLOWED_ORIGINS:'http://localhost:5999'}),/return origin/);
  assert.equal(identityFromEnv(env)?.issuer,fixture.issuer);assert.equal(identityFromEnv({}),undefined);assert.throws(()=>identityFromEnv({...env,NODE_ENV:'production'}));
  await chmod(path,0o644);assert.throws(()=>identityFromEnv(env));await chmod(path,0o600);await symlink(path,join(root,'link'));assert.throws(()=>identityFromEnv({...env,INVEOS_IDENTITY_CONFIG:join(root,'link')}));await writeFile(path,' '.repeat(32769));assert.throws(()=>identityFromEnv(env));
 }finally{await fixture.close();await rm(root,{recursive:true,force:true});}
});
