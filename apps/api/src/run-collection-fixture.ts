/** Explicit local fictional HTTP exercise. This command cannot contact the provider. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {originalStoreFromEnv} from './original-encryption.js';
import {createPool} from './db.js';
import {runCollectionJob} from './collection-jobs.js';
import {CollectionFailure} from './collection-transport.js';
const [tenantId,caseId,jobId,...extra]=process.argv.slice(2),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
if(!tenantId||!caseId||!jobId||extra.length||![tenantId,caseId,jobId].every(v=>uuid.test(v)))throw new Error('Supply tenant, case and collection-job UUIDs for the fictional FIC00001 fixture.');
const database=process.env.INVEOS_DATABASE_URL,root=process.env.INVEOS_STORAGE_ROOT;
if(process.env.INVEOS_DEV_LAB!=='1'||process.env.NODE_ENV==='production'||!database||!/^postgres(?:ql)?:\/\//.test(database)||!root||!isAbsolute(root))throw new Error('Fictional development mode and restricted database/original storage are required.');
const storage=originalStoreFromEnv(root),pool=createPool(database,process.env.INVEOS_COLLECTION_SCHEMA??'inveos'),bytes=await readFile(new URL('../../../tests/fixtures/company-profile-fictional.json',import.meta.url));
const server=createServer((req,res)=>{if(req.url!=='/fictional/FIC00001'){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'application/json',etag:'fictional-fixture-v1'});res.end(bytes);});
const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const {port}=server.address() as {port:number};
 const result=await runCollectionJob({pool,storage,tenantId,caseId,jobId,credentialScope:createHash('sha256').update('INVEOS fictional fixture provider; no credential').digest('hex'),signal:controller.signal,transport:async(number,signal)=>{
  if(number!=='FIC00001')throw new CollectionFailure('fixture_identifier_required');const r=await fetch(`http://127.0.0.1:${port}/fictional/FIC00001`,{signal,redirect:'error'});
  return {provenance:'fictional_fixture',status:r.status,body:Buffer.from(await r.arrayBuffer()),date:r.headers.get('date'),etag:r.headers.get('etag'),contentType:r.headers.get('content-type')??'',retryAfter:null};
 }});process.stdout.write(JSON.stringify({jobId,result,fictional:true,providerContacted:false})+'\n');if(result!=='succeeded'&&result!=='not_queued')process.exitCode=1;
}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();}
