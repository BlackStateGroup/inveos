/** Executes one already-authorised queued job against an actual loopback HTTP fixture. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createPool} from './db.js';
import {originalStoreFromEnv} from './original-encryption.js';
import {runResearchCapture} from './research-jobs.js';
import {gleifLoopbackTransport} from './gleif-transport.js';
import {fictionalLei} from './gleif-adapter.js';
const [tenantId,caseId,runId,...extra]=process.argv.slice(2),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
if(!tenantId||!caseId||!runId||extra.length||![tenantId,caseId,runId].every(x=>uuid.test(x)))throw new Error('Supply tenant, case and queued research-run UUIDs.');
const database=process.env.INVEOS_DATABASE_URL,root=process.env.INVEOS_STORAGE_ROOT;
if(process.env.INVEOS_DEV_LAB!=='1'||process.env.NODE_ENV==='production'||!database||!/^postgres(?:ql)?:\/\//.test(database)||!root||!isAbsolute(root))throw new Error('Fictional development mode, restricted database and original store required.');
const pool=createPool(database,process.env.INVEOS_COLLECTION_SCHEMA??'inveos',2),storage=originalStoreFromEnv(root),bytes=await readFile(new URL('../../../tests/fixtures/gleif-lei-fictional.json',import.meta.url));
const server=createServer((req,res)=>{if(req.method!=='GET'||req.url!=='/api/v1/lei-records/'+fictionalLei){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'application/vnd.api+json','etag':'fictional-lei-v1'});res.end(bytes);});
const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const {port}=server.address() as {port:number};const result=await runResearchCapture({pool,storage,tenantId,caseId,runId,leiTransport:gleifLoopbackTransport(port),signal:controller.signal});process.stdout.write(JSON.stringify({...result,fictional:true,providerContacted:false})+'\n');if(result.status!=='succeeded')process.exitCode=1;}
finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();}
