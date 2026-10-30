import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {inspectResearchCapture,researchTarget} from '../src/research-adapters.js';
import {rdapLoopbackTransport,rdapProviderTransport,rdapFixtureEndpoint} from '../src/rdap-transport.js';
import type {ResearchCaptureInput} from '@inveos/contracts';
const raw=await readFile(new URL('../../../tests/fixtures/rdap-domain-fictional.json',import.meta.url));
const now=new Date('2026-10-30T12:00:00Z');
const input:ResearchCaptureInput={contentBase64:raw.toString('base64'),filename:'fictional.json',publisher:'Fictional RDAP response',sourceTime:'2026-10-01T13:00:00+01:00',retrievedAt:'2026-10-02T12:00:00Z',sourceTimeBasis:'declared_response_date',captureMode:'controlled_response',mediaType:'application/rdap+json',fictional:true};
test('RDAP input retains original bytes and exact domain pointers without linked contact traversal',()=>{
 const parsed=inspectResearchCapture('rdap_domain_v1','example.test',input,now);assert.deepEqual(parsed.bytes,raw);assert.ok(parsed.fields.some(f=>f.pointer==='/events/0/eventDate'));assert.ok(parsed.fields.every(f=>!f.pointer.includes('entities')&&!f.pointer.includes('links')));
 for(const body of ['{"objectClassName":"domain","ldhName":"other.test"}','{"objectClassName":"domain","ldhName":"example.test","ldhName":"example.test"}'])assert.throws(()=>inspectResearchCapture('rdap_domain_v1','example.test',{...input,contentBase64:Buffer.from(body).toString('base64')},now));
 assert.throws(()=>inspectResearchCapture('rdap_domain_v1','example.test',{...input,contentBase64:Buffer.alloc(262145).toString('base64')},now));
 for(const target of ['../x','https://example.test','EXAMPLE.test','*.test','127.0.0.1','a.test?secret=x','a.local'])assert.throws(()=>researchTarget('rdap_domain_v1',target,rdapFixtureEndpoint));
 assert.throws(()=>researchTarget('supplied_webpage_v1','https://other.test/page','https://supplier.example.test/'));
});
test('supplied HTML is preserved as inert source bytes without extracted active content',async()=>{
 const bytes=await readFile(new URL('../../../tests/fixtures/supplied-webpage-fictional.html',import.meta.url));
 const result=inspectResearchCapture('supplied_webpage_v1','https://supplier.example.test/page',{...input,contentBase64:bytes.toString('base64'),filename:'fictional.html',mediaType:'text/html',captureMode:'supplied_webpage',sourceTimeBasis:'declared_page_time'},now);assert.deepEqual(result.bytes,bytes);assert.deepEqual(result.fields,[]);
});
test('RDAP live activation fails closed; loopback uses the bounded transport and rejects redirects and oversized responses',async()=>{
 await assert.rejects(rdapProviderTransport()({endpointScope:'https://rdap.verisign.com/com/v1/domain/',domain:'example.com'},new AbortController().signal),/live_collection_disabled/);
 let mode='success',calls=0;const server=createServer((req,res)=>{calls++;assert.equal(req.url,'/domain/example.test');if(mode==='redirect'){res.writeHead(302,{location:'https://never-follow.example.test/'});res.end();}else if(mode==='large'){res.writeHead(200,{'content-length':'262145'});res.end();}else{res.writeHead(200,{'content-type':'application/rdap+json'});res.end(raw);}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const transport=rdapLoopbackTransport((server.address() as {port:number}).port),scope={endpointScope:rdapFixtureEndpoint,domain:'example.test'};
 try{const response=await transport(scope,new AbortController().signal);assert.deepEqual(response.body,raw);assert.equal(response.sourceUrl,rdapFixtureEndpoint+'example.test');assert.equal(response.provenance,'fictional_fixture');assert.equal(calls,1);await assert.rejects(transport({...scope,domain:'other.test'},new AbortController().signal),/fixture_scope_required/);assert.equal(calls,1);mode='redirect';await assert.rejects(transport(scope,new AbortController().signal),/redirect_denied/);mode='large';await assert.rejects(transport(scope,new AbortController().signal),/response_too_large/);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('GLEIF supplied record validates exact LEI/check digits, excludes linked persons and disables live transport',async()=>{
 const {fictionalLei,gleifEndpoint,leiIdentifier}=await import('../src/gleif-adapter.js');const {gleifProviderTransport}=await import('../src/gleif-transport.js');
 const raw=await readFile(new URL('../../../tests/fixtures/gleif-lei-fictional.json',import.meta.url)),capture={...input,contentBase64:raw.toString('base64'),mediaType:'application/vnd.api+json' as const};
 const parsed=inspectResearchCapture('gleif_lei_v1',fictionalLei,capture,now);assert.deepEqual(parsed.bytes,raw);assert.ok(parsed.fields.some(f=>f.pointer==='/data/attributes/entity/legalName/name'));assert.ok(parsed.fields.every(f=>!/(relationships|addresses|links|people)/.test(f.pointer)));
 for(const id of [fictionalLei.toLowerCase(),'../'+fictionalLei,fictionalLei.slice(0,-1)+'1','https://api.gleif.org/'+fictionalLei])assert.throws(()=>leiIdentifier(id));
 for(const changed of [JSON.stringify({...JSON.parse(raw.toString()),errors:[]}),raw.toString().replace(fictionalLei,'00000000000000000000'),'{"data":null}',raw.toString().replace('"data":','"data":{},"data":')])assert.throws(()=>inspectResearchCapture('gleif_lei_v1',fictionalLei,{...capture,contentBase64:Buffer.from(changed).toString('base64')},now));
 await assert.rejects(gleifProviderTransport()({endpointScope:gleifEndpoint,lei:fictionalLei},new AbortController().signal),/live_collection_disabled/);
});
for(const kind of ['rdap','gleif'] as const)test(kind+' actual loopback rejects compression, chunked overflow, truncation, scope substitution and cancellation',async()=>{
 const {fictionalLei,gleifEndpoint}=await import('../src/gleif-adapter.js');const {gleifLoopbackTransport}=await import('../src/gleif-transport.js');let mode='compression',calls=0;
 const server=createServer((_req,res)=>{calls++;if(mode==='compression'){res.writeHead(200,{'content-encoding':'gzip'});res.end('fictional');}else if(mode==='overflow'){res.writeHead(200);res.end(Buffer.alloc(262145));}else if(mode==='truncated'){res.writeHead(200,{'content-length':'100'});res.write('short');setTimeout(()=>res.destroy(),10);}else if(mode==='redirect'){res.writeHead(302,{location:'http://127.0.0.1:1/forbidden'});res.end();}});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as {port:number}).port,transport=kind==='rdap'?rdapLoopbackTransport(port):gleifLoopbackTransport(port),scope={endpointScope:kind==='rdap'?rdapFixtureEndpoint:gleifEndpoint,domain:'example.test',lei:fictionalLei};
 try{for(const [value,error] of [['compression','encoded_response_denied'],['overflow','response_too_large'],['truncated','truncated_response'],['redirect','redirect_denied']]){mode=value!;await assert.rejects(transport(scope,new AbortController().signal),new RegExp(error!));}const before=calls;await assert.rejects(transport({...scope,endpointScope:'http://127.0.0.1/'},new AbortController().signal),/fixture_scope_required/);assert.equal(calls,before);mode='wait';const controller=new AbortController(),request=transport(scope,controller.signal);setTimeout(()=>controller.abort(),20);await assert.rejects(request,/cancelled/);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
