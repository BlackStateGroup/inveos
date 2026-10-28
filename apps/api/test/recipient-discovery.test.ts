import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDisclosurePage,readDisclosureBytes} from '../../web/src/recipientDiscovery.js';
const item={id:'11111111-1111-4111-8111-111111111111',revisionId:'22222222-2222-4222-8222-222222222222',sha256:'a'.repeat(64),createdAt:'2026-10-28T01:00:00Z',expiresAt:'2026-10-29T01:00:00Z'};
test('recipient list guard preserves fingerprints and removes unsolicited metadata',()=>{
 assert.deepEqual(readDisclosurePage({items:[{...item,reason:'must not render'}],nextBefore:item.id}),{items:[item],nextBefore:item.id});assert.deepEqual(readDisclosurePage({items:[],nextBefore:null}),{items:[],nextBefore:null});
});
test('recipient list guard denies malformed rows, repeated grants, cursor substitutions and excess pages',()=>{
 for(const page of [null,{}, {items:[],nextBefore:item.id},{items:[item,item],nextBefore:null},{items:Array(51).fill(item),nextBefore:null},...[{id:'../../internal'},{sha256:'bad'},{revisionId:1},{createdAt:'invalid'},{expiresAt:null}].map(change=>({items:[{...item,...change}],nextBefore:null}))])assert.throws(()=>readDisclosurePage(page),/invalid/);
});

test('recipient download reader bounds streamed bytes without trusting content length',async()=>{
 const bytes=await readDisclosureBytes(new Response('fictional'),9);assert.equal(new TextDecoder().decode(bytes),'fictional');
 let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4));c.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}}),{headers:{'Content-Length':'1'}});
 await assert.rejects(readDisclosureBytes(response,7),/size limit/);assert.equal(cancelled,true);await assert.rejects(readDisclosureBytes(new Response(null)),/no body/);
});
