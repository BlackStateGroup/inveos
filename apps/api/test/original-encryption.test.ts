import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,cp,chmod,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptedOriginalStore,originalStoreFromEnv} from '../src/original-encryption.js';
import {writeOriginal,readOriginalBounded} from '../src/storage.js';
const ids=()=>[randomUUID(),randomUUID(),randomUUID()] as const;
test('encrypted custody preserves exact bytes, exclusive immutable writes and path-bound authenticated scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inveos-cipher-')),key=randomBytes(32),store=encryptedOriginalStore(root,'fictional-v1',{['fictional-v1']:key});
 try{const scope=ids(),bytes=Buffer.from('FICTIONAL original £50 — not real investigative data.'),original=await writeOriginal(store,...scope,bytes);
  assert.ok(original.objectPath.endsWith('.txt.enc'));const sealed=await readFile(join(root,original.objectPath));assert.equal(sealed.includes(bytes),false);assert.deepEqual(await readOriginalBounded(store,original.objectPath,262144),bytes);
  await assert.rejects(writeOriginal(store,...scope,Buffer.from('replace')),/EEXIST/);assert.deepEqual(await readFile(join(root,original.objectPath)),sealed);
  await assert.rejects(readOriginalBounded(root,original.objectPath,262144),/mode mismatch/);
  const other=await writeOriginal(store,...ids(),bytes);assert.notDeepEqual(await readFile(join(root,other.objectPath)),sealed);
  await writeFile(join(root,other.objectPath),sealed);await assert.rejects(readOriginalBounded(store,other.objectPath,262144),/authentication/);
  for(const at of [0,8,10,sealed.length-17,sealed.length-1]){const altered=Buffer.from(sealed);altered[at]=altered[at]!^1;await writeFile(join(root,original.objectPath),altered);await assert.rejects(readOriginalBounded(store,original.objectPath,262144),/authentication/);}
  await writeFile(join(root,original.objectPath),sealed);await assert.rejects(readOriginalBounded(store,original.objectPath,bytes.length-1),/size limit|authentication/);
  await writeFile(join(root,original.objectPath),Buffer.concat([sealed,Buffer.from([0])]));await assert.rejects(readOriginalBounded(store,original.objectPath,262144),/authentication/);
 }finally{await rm(root,{recursive:true,force:true});key.fill(0);}
});
test('key rotation uses new writes while old bytes survive restart and a separately restored root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inveos-rotation-')),old=randomBytes(32),next=randomBytes(32),bytes=Buffer.from('Fictional custody restart/restore record');
 try{const first=encryptedOriginalStore(join(root,'objects'),'old',{old}),one=await writeOriginal(first,...ids(),bytes);const sealed=await readFile(join(root,'objects',one.objectPath));
  const rotated=encryptedOriginalStore(join(root,'objects'),'next',{old,next}),two=await writeOriginal(rotated,...ids(),bytes);assert.deepEqual(await readOriginalBounded(rotated,one.objectPath,262144),bytes);assert.deepEqual(await readOriginalBounded(rotated,two.objectPath,262144),bytes);assert.deepEqual(await readFile(join(root,'objects',one.objectPath)),sealed);
  const revoked=encryptedOriginalStore(join(root,'objects'),'next',{next});await assert.rejects(readOriginalBounded(revoked,one.objectPath,262144),/authentication/);assert.deepEqual(await readOriginalBounded(revoked,two.objectPath,262144),bytes);
  await cp(join(root,'objects'),join(root,'restored'),{recursive:true});const restored=encryptedOriginalStore(join(root,'restored'),'next',{old,next});assert.deepEqual(await readOriginalBounded(restored,one.objectPath,262144),bytes);
  await assert.rejects(readOriginalBounded(encryptedOriginalStore(join(root,'restored'),'old',{old:randomBytes(32)}),one.objectPath,262144),/authentication/);
 }finally{await rm(root,{recursive:true,force:true});old.fill(0);next.fill(0);}
});
test('protected key configuration fails closed on permissions, malformed keys, symlinks and co-located secrets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inveos-config-')),file=join(root,'keys.json'),objects=join(root,'objects');
 const valid={format:'inveos_original_keys_v1',activeKeyId:'first',keys:{first:randomBytes(32).toString('hex')}},env={INVEOS_ORIGINAL_STORAGE_MODE:'encrypted-v1',INVEOS_ORIGINAL_KEYS_FILE:file};
 try{await writeFile(file,JSON.stringify(valid),{mode:0o600});const store=originalStoreFromEnv(objects,env);assert.notEqual(typeof store,'string');assert.equal(JSON.stringify(store).includes(valid.keys.first),false);
  await chmod(file,0o644);assert.throws(()=>originalStoreFromEnv(objects,env),/private/);await chmod(file,0o600);
  await symlink(file,join(root,'alias'));assert.throws(()=>originalStoreFromEnv(objects,{...env,INVEOS_ORIGINAL_KEYS_FILE:join(root,'alias')}));
  assert.throws(()=>originalStoreFromEnv(root,env),/outside/);assert.throws(()=>originalStoreFromEnv(root,{...env,INVEOS_ORIGINAL_KEYS_FILE:join(root,'..keys.json')}),/outside/);assert.throws(()=>originalStoreFromEnv(objects,{INVEOS_ORIGINAL_KEYS_FILE:file}),/explicit/);
  await mkdir(objects);await writeFile(join(objects,'keys.json'),JSON.stringify(valid),{mode:0o600});await symlink(objects,join(root,'alias-dir'));assert.throws(()=>originalStoreFromEnv(objects,{...env,INVEOS_ORIGINAL_KEYS_FILE:join(root,'alias-dir','keys.json')}),/outside/);
  for(const data of [{...valid,activeKeyId:'absent'},{...valid,keys:{first:'00'}},{...valid,format:'unknown'},{...valid,extra:true}]){await writeFile(file,JSON.stringify(data));assert.throws(()=>originalStoreFromEnv(objects,env),/Invalid/);}
  await writeFile(file,'x'.repeat(8193));assert.throws(()=>originalStoreFromEnv(objects,env),/bounded/);
  assert.throws(()=>encryptedOriginalStore(objects,'toString',{}),/Invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('encrypted mode rejects plaintext substitution and oversized inputs without leaving an accepted original',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inveos-denial-')),key=randomBytes(32),store=encryptedOriginalStore(root,'key',{key});
 try{const scope=ids();await assert.rejects(writeOriginal(store,...scope,Buffer.alloc(262145)),/size limit/);const original=await writeOriginal(store,...scope,Buffer.from('FICTIONAL'));await writeFile(join(root,original.objectPath),Buffer.from('plaintext substitution'));await assert.rejects(readOriginalBounded(store,original.objectPath,262144),/authentication/);
  const plain=await writeOriginal(root,...ids(),Buffer.from('FICTIONAL legacy'));await assert.rejects(readOriginalBounded(store,plain.objectPath,262144),/mode mismatch/);await assert.rejects(readOriginalBounded(store,original.objectPath,Number.MAX_SAFE_INTEGER),/size limit/);
 }finally{await rm(root,{recursive:true,force:true});key.fill(0);}
});
test('Tika 2 MiB read budget reads existing bounded encrypted originals without expanding intake or bypassing smaller limits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'inveos-tika-read-')),key=randomBytes(32),store=encryptedOriginalStore(root,'fictional',{fictional:key});
 try{const bytes=Buffer.from('%PDF-1.4\nFICTIONAL supplied bytes'),saved=await writeOriginal(store,...ids(),bytes,'bin');assert.deepEqual(await readOriginalBounded(store,saved.objectPath,2097152),bytes);await assert.rejects(readOriginalBounded(store,saved.objectPath,bytes.length-1));await assert.rejects(readOriginalBounded(store,saved.objectPath,2097153));await assert.rejects(writeOriginal(store,...ids(),Buffer.alloc(262145),'bin'));}finally{await rm(root,{recursive:true,force:true});key.fill(0);}
});
